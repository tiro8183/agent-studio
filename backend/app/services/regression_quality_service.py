from sqlmodel import Session, select

from app.core.models import Agent, now_iso
from app.core.schemas import (
    AgentRegressionCaseRead,
    RegressionQualityAgentRead,
    RegressionQualityCaseRead,
    RegressionQualityOverviewRead,
)
from app.services.regression_coverage_service import build_regression_coverage


def build_regression_quality_overview(
    session: Session,
    org_id: str,
    limit: int = 80,
) -> RegressionQualityOverviewRead:
    agents = session.exec(
        select(Agent)
        .where(Agent.org_id == org_id)
        .order_by(Agent.updated_at.desc())
    ).all()
    summaries: list[RegressionQualityAgentRead] = []
    blocker_cases: list[RegressionQualityCaseRead] = []
    totals = {
        "active_cases": 0,
        "passed": 0,
        "failed": 0,
        "running": 0,
        "stale": 0,
        "untested": 0,
        "inactive_cases": 0,
    }

    for agent in agents:
        coverage = build_regression_coverage(agent, session)
        summaries.append(
            RegressionQualityAgentRead(
                agent_id=agent.id,
                agent_name=agent.name,
                status=agent.status,
                version=agent.version,
                runtime_plan_hash=coverage.runtime_plan_hash,
                coverage_percent=coverage.coverage_percent,
                total=coverage.total,
                passed=coverage.passed,
                failed=coverage.failed,
                running=coverage.running,
                stale=coverage.stale,
                untested=coverage.untested,
                inactive_cases=coverage.inactive_cases,
                can_publish=coverage.can_publish,
                blockers=coverage.blockers,
                latest_suite_run=coverage.latest_suite_run,
            )
        )
        totals["active_cases"] += coverage.active_cases
        totals["passed"] += coverage.passed
        totals["failed"] += coverage.failed
        totals["running"] += coverage.running
        totals["stale"] += coverage.stale
        totals["untested"] += coverage.untested
        totals["inactive_cases"] += coverage.inactive_cases
        blocker_cases.extend(
            _quality_case(agent, item)
            for item in coverage.cases
            if _is_blocking_case(item)
        )

    blocker_cases.sort(key=_case_sort_key)
    publish_ready_agents = sum(1 for item in summaries if item.can_publish)
    active_cases = totals["active_cases"]
    return RegressionQualityOverviewRead(
        generated_at=now_iso(),
        agents=len(summaries),
        publish_ready_agents=publish_ready_agents,
        blocked_agents=len(summaries) - publish_ready_agents,
        active_cases=active_cases,
        passed=totals["passed"],
        failed=totals["failed"],
        running=totals["running"],
        stale=totals["stale"],
        untested=totals["untested"],
        inactive_cases=totals["inactive_cases"],
        coverage_percent=round(totals["passed"] / active_cases * 100) if active_cases else 0,
        blockers=sum(len(item.blockers) for item in summaries),
        agent_summaries=summaries,
        blocker_cases=blocker_cases[: max(limit, 0)],
    )


def _is_blocking_case(item: AgentRegressionCaseRead) -> bool:
    if item.status != "active":
        return False
    return item.freshness != "current" or item.result_status in {"failed", "error", "running"}


def _quality_case(agent: Agent, item: AgentRegressionCaseRead) -> RegressionQualityCaseRead:
    severity, reason = _case_reason(item)
    return RegressionQualityCaseRead(
        **item.model_dump(),
        agent_id=agent.id,
        agent_name=agent.name,
        agent_status=agent.status,
        severity=severity,
        reason=reason,
    )


def _case_reason(item: AgentRegressionCaseRead) -> tuple[str, str]:
    if item.result_status in {"failed", "error"}:
        return "critical", "当前规格验收失败"
    if item.result_status == "running":
        return "warning", "验收仍在运行"
    if item.freshness == "stale":
        return "warning", "运行结果已过期"
    if item.freshness == "untested":
        return "warning", "尚未运行当前规格"
    return "info", "需要复核"


def _case_sort_key(item: RegressionQualityCaseRead) -> tuple[int, int, str]:
    severity_rank = {"critical": 0, "warning": 1, "info": 2}
    freshness_rank = {"current": 0, "stale": 1, "untested": 2, "inactive": 3}
    return (
        severity_rank.get(item.severity, 9),
        freshness_rank.get(item.freshness, 9),
        item.last_run_at or "",
    )
