from dataclasses import dataclass

from sqlalchemy import ColumnElement, func
from sqlmodel import Session, select

from app.core.models import Agent, AgentTestCase, AgentTestRun, AgentTestSuiteRun, now_iso
from app.core.schemas import (
    AgentRegressionCaseRead,
    AgentRegressionCoverageRead,
    AgentRegressionSuiteRunRead,
)
from app.services.mappers import _loads
from app.services.runtime_plan_service import build_preview_runtime_plan


@dataclass(frozen=True)
class RegressionRunIndex:
    latest_by_case: dict[str, AgentTestRun]
    running_by_case: dict[str, AgentTestRun]
    current_hash_by_case: dict[str, AgentTestRun]

    def current_for_case(self, case_id: str) -> AgentTestRun | None:
        return self.running_by_case.get(case_id) or self.current_hash_by_case.get(case_id)


def build_regression_coverage(agent: Agent, session: Session) -> AgentRegressionCoverageRead:
    runtime_plan = build_preview_runtime_plan(agent, session)
    cases = session.exec(
        select(AgentTestCase)
        .where(AgentTestCase.agent_id == agent.id, AgentTestCase.org_id == agent.org_id)
        .order_by(AgentTestCase.status.asc(), AgentTestCase.created_at.asc())
    ).all()
    run_index = build_regression_run_index(
        session,
        org_id=agent.org_id,
        agent_id=agent.id,
        case_ids=[row.id for row in cases],
        runtime_plan_hash=runtime_plan.spec_hash,
    )

    case_reads = [
        _case_to_coverage(row, run_index.current_for_case(row.id), run_index.latest_by_case.get(row.id), runtime_plan.spec_hash)
        for row in cases
    ]
    active_cases = [case for case in case_reads if case.status == "active"]
    passed = sum(1 for case in active_cases if case.freshness == "current" and case.result_status == "passed")
    failed = sum(1 for case in active_cases if case.freshness == "current" and case.result_status in {"failed", "error"})
    running = sum(1 for case in active_cases if case.freshness == "current" and case.result_status == "running")
    stale = sum(1 for case in active_cases if case.freshness == "stale")
    untested = sum(1 for case in active_cases if case.freshness == "untested")
    total = len(active_cases)
    blockers = _coverage_blockers(total, failed, running, stale, untested)
    latest_suite = _latest_suite_run(agent, session)
    return AgentRegressionCoverageRead(
        agent_id=agent.id,
        agent_name=agent.name,
        runtime_plan_hash=runtime_plan.spec_hash,
        generated_at=now_iso(),
        total=total,
        active_cases=total,
        inactive_cases=len(case_reads) - total,
        passed=passed,
        failed=failed,
        running=running,
        stale=stale,
        untested=untested,
        coverage_percent=round(passed / total * 100) if total else 0,
        can_publish=not blockers,
        blockers=blockers,
        latest_suite_run=_suite_to_read(latest_suite, runtime_plan.spec_hash) if latest_suite else None,
        cases=case_reads,
    )


def build_regression_run_index(
    session: Session,
    *,
    org_id: str,
    agent_id: str,
    case_ids: list[str],
    runtime_plan_hash: str,
) -> RegressionRunIndex:
    scoped_case_ids = list(dict.fromkeys(case_ids))
    if not scoped_case_ids:
        return RegressionRunIndex(latest_by_case={}, running_by_case={}, current_hash_by_case={})
    return RegressionRunIndex(
        latest_by_case=_latest_runs_by_case(
            session,
            org_id=org_id,
            agent_id=agent_id,
            case_ids=scoped_case_ids,
        ),
        running_by_case=_latest_runs_by_case(
            session,
            org_id=org_id,
            agent_id=agent_id,
            case_ids=scoped_case_ids,
            filters=(AgentTestRun.status == "running",),
        ),
        current_hash_by_case=_latest_runs_by_case(
            session,
            org_id=org_id,
            agent_id=agent_id,
            case_ids=scoped_case_ids,
            filters=(AgentTestRun.runtime_plan_hash == runtime_plan_hash,),
        ),
    )


def _latest_runs_by_case(
    session: Session,
    *,
    org_id: str,
    agent_id: str,
    case_ids: list[str],
    filters: tuple[ColumnElement[bool], ...] = (),
) -> dict[str, AgentTestRun]:
    ranked_runs = (
        select(
            AgentTestRun.id,
            func.row_number()
            .over(
                partition_by=AgentTestRun.case_id,
                order_by=(AgentTestRun.started_at.desc(), AgentTestRun.id.desc()),
            )
            .label("rank"),
        )
        .where(
            AgentTestRun.org_id == org_id,
            AgentTestRun.agent_id == agent_id,
            AgentTestRun.case_id.in_(case_ids),
            *filters,
        )
        .subquery()
    )
    rows = session.exec(
        select(AgentTestRun)
        .join(ranked_runs, AgentTestRun.id == ranked_runs.c.id)
        .where(ranked_runs.c.rank == 1)
    ).all()
    return {row.case_id: row for row in rows}


def _case_to_coverage(
    row: AgentTestCase,
    current_run: AgentTestRun | None,
    latest_run: AgentTestRun | None,
    runtime_plan_hash: str,
) -> AgentRegressionCaseRead:
    selected_run = current_run or latest_run
    if row.status != "active":
        freshness = "inactive"
        result_status = row.last_status or "untested"
    elif current_run and current_run.status == "running":
        freshness = "current"
        result_status = "running"
    elif current_run:
        freshness = "current"
        result_status = current_run.status
    elif latest_run:
        freshness = "stale"
        result_status = latest_run.status
    else:
        freshness = "untested"
        result_status = "untested"

    assertion = _loads(row.assertion_json, {})
    expected_keywords = _loads(row.expected_keywords_json, [])
    return AgentRegressionCaseRead(
        id=row.id,
        name=row.name,
        status=row.status,
        result_status=result_status,
        freshness=freshness,
        input_preview=_clip_text(row.input_text, 120),
        expected_keywords=expected_keywords,
        required_tools=[str(item) for item in assertion.get("required_tools", []) if item],
        required_subagents=[str(item) for item in assertion.get("required_subagents", []) if item],
        required_event_types=[str(item) for item in assertion.get("required_event_types", []) if item],
        max_duration_ms=assertion.get("max_duration_ms"),
        test_run_id=selected_run.id if selected_run else None,
        agent_run_id=selected_run.agent_run_id if selected_run else row.last_run_id,
        last_runtime_plan_hash=selected_run.runtime_plan_hash if selected_run else row.last_runtime_plan_hash,
        current_runtime_plan_hash=runtime_plan_hash,
        last_run_at=selected_run.ended_at or selected_run.started_at if selected_run else row.last_run_at,
        last_error=selected_run.error if selected_run else row.last_error,
    )


def _latest_suite_run(agent: Agent, session: Session) -> AgentTestSuiteRun | None:
    return session.exec(
        select(AgentTestSuiteRun)
        .where(AgentTestSuiteRun.agent_id == agent.id, AgentTestSuiteRun.org_id == agent.org_id)
        .order_by(AgentTestSuiteRun.started_at.desc())
        .limit(1)
    ).first()


def _suite_to_read(row: AgentTestSuiteRun, runtime_plan_hash: str) -> AgentRegressionSuiteRunRead:
    return AgentRegressionSuiteRunRead(
        id=row.id,
        status=row.status,
        runtime_plan_hash=row.runtime_plan_hash,
        is_current=row.runtime_plan_hash == runtime_plan_hash,
        total=row.total,
        passed=row.passed,
        failed=row.failed,
        duration_ms=row.duration_ms,
        started_at=row.started_at,
        ended_at=row.ended_at,
    )


def _coverage_blockers(total: int, failed: int, running: int, stale: int, untested: int) -> list[str]:
    blockers: list[str] = []
    if total == 0:
        blockers.append("至少需要 1 个启用验收用例")
    if failed:
        blockers.append(f"{failed} 个当前规格用例未通过")
    if running:
        blockers.append(f"{running} 个当前规格用例仍在运行")
    if stale:
        blockers.append(f"{stale} 个用例结果已过期")
    if untested:
        blockers.append(f"{untested} 个用例尚未运行")
    return blockers


def _clip_text(value: str, limit: int) -> str:
    text = " ".join((value or "").split())
    if len(text) <= limit:
        return text
    return f"{text[:limit - 1]}…"
