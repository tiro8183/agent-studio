import json
from jsonschema import ValidationError, validate
from time import perf_counter
from typing import Any, List

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import AgentTestRun, AgentRun, AgentTestCase, AgentTestSuiteRun, new_id, now_iso
from app.core.schemas import (
    AgentTestCaseCreate,
    AgentTestCaseRead,
    AgentTestCaseUpdate,
    AgentTestRunRead,
    AgentTestSuiteRunRead,
)
from app.db.session import get_session
from app.services.agent_execution_service import AgentExecutionService
from app.services.execution_gateway import ExecutionGateway, ExecutionGatewayOptions
from app.services.mappers import _dumps, _loads
from app.services.openai_compatible_service import ResponsesRequest, responses_to_execution
from app.services.run_event_service import read_run_events
from app.services.runtime_plan_service import build_runtime_plan
from app.services.tenant_scope import get_agent_or_404, get_test_case_or_404
from app.services.test_case_lifecycle_service import delete_test_case_resources

router = APIRouter(prefix="/test-cases", tags=["test-cases"])


def _to_read(row: AgentTestCase) -> AgentTestCaseRead:
    expected_keywords = _loads(row.expected_keywords_json, [])
    assertion = _loads(row.assertion_json, {})
    if expected_keywords and not assertion.get("required_keywords"):
        assertion["required_keywords"] = expected_keywords
    return AgentTestCaseRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        name=row.name,
        input_text=row.input_text,
        expected_keywords=expected_keywords,
        assertion=assertion,
        status=row.status,
        last_status=row.last_status,
        last_output=row.last_output,
        last_error=row.last_error,
        last_run_id=row.last_run_id,
        last_runtime_plan_hash=row.last_runtime_plan_hash,
        last_run_at=row.last_run_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _test_run_to_read(row: AgentTestRun) -> AgentTestRunRead:
    assertion = _loads(row.assertion_json, {})
    expected_keywords = _loads(row.expected_keywords_json, [])
    if expected_keywords and not assertion.get("required_keywords"):
        assertion["required_keywords"] = expected_keywords
    return AgentTestRunRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        case_id=row.case_id,
        suite_run_id=row.suite_run_id,
        agent_run_id=row.agent_run_id,
        conversation_id=row.conversation_id,
        runtime_plan_hash=row.runtime_plan_hash,
        case_name=row.case_name,
        input_text=row.input_text,
        expected_keywords=expected_keywords,
        assertion=assertion,
        status=row.status,
        output=row.output,
        error=row.error,
        assertion_errors=_loads(row.assertion_errors_json, []),
        duration_ms=row.duration_ms,
        started_at=row.started_at,
        ended_at=row.ended_at,
    )


def _suite_run_to_read(
    row: AgentTestSuiteRun,
    cases: list[AgentTestCaseRead],
    runs: list[AgentTestRunRead],
) -> AgentTestSuiteRunRead:
    return AgentTestSuiteRunRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        runtime_plan_hash=row.runtime_plan_hash,
        status=row.status,
        total=row.total,
        passed=row.passed,
        failed=row.failed,
        duration_ms=row.duration_ms,
        started_at=row.started_at,
        ended_at=row.ended_at,
        cases=cases,
        runs=runs,
    )


def _latest_case_run(session: Session, agent_id: str, conversation_id: str, org_id: str) -> AgentRun | None:
    return session.exec(
        select(AgentRun)
        .where(AgentRun.agent_id == agent_id, AgentRun.conversation_id == conversation_id, AgentRun.org_id == org_id)
        .order_by(AgentRun.started_at.desc())
        .limit(1)
    ).first()


def _event_values(events: list[dict[str, Any]], key: str) -> set[str]:
    return {str(event.get(key) or "") for event in events if event.get(key)}


def _validate_json_schema(output: str, schema: dict[str, Any]) -> str:
    if not schema:
        return ""
    try:
        value = json.loads(output)
    except json.JSONDecodeError as exc:
        return f"输出不是合法 JSON: {exc.msg}"
    try:
        validate(instance=value, schema=schema)
    except ValidationError as exc:
        return f"结构化格式约束不匹配: {exc.message}"
    return ""


def _assert_case(session: Session, row: AgentTestCase, output: str, run: AgentRun | None) -> list[str]:
    assertion = _loads(row.assertion_json, {})
    expected_keywords = _loads(row.expected_keywords_json, [])
    required_keywords = assertion.get("required_keywords") or expected_keywords
    errors = [f"缺少关键词: {keyword}" for keyword in required_keywords if keyword and keyword not in output]
    events = read_run_events(session, run) if run else []
    event_types = {str(event.get("type") or "") for event in events}
    tools = _event_values(events, "tool") | _event_values(events, "resource")
    subagents = _event_values(events, "subagent")
    errors.extend(
        f"未观察到工具调用: {tool}"
        for tool in assertion.get("required_tools", [])
        if tool and tool not in tools
    )
    errors.extend(
        f"未观察到子代理委派: {subagent}"
        for subagent in assertion.get("required_subagents", [])
        if subagent and subagent not in subagents
    )
    errors.extend(
        f"未观察到事件类型: {event_type}"
        for event_type in assertion.get("required_event_types", [])
        if event_type and event_type not in event_types
    )
    schema_error = _validate_json_schema(output, assertion.get("required_json_schema") or {})
    if schema_error:
        errors.append(schema_error)
    max_duration = assertion.get("max_duration_ms")
    if max_duration and run and run.duration_ms > int(max_duration):
        errors.append(f"耗时超过上限: {run.duration_ms} ms > {max_duration} ms")
    return errors


def _cache_case_result(row: AgentTestCase, test_run: AgentTestRun, finished_at: str) -> None:
    if row.last_run_at and row.last_run_at > finished_at:
        return
    row.last_status = "passed" if test_run.status == "passed" else "failed"
    row.last_output = test_run.output[:2000]
    row.last_error = test_run.error[:500]
    row.last_run_id = test_run.agent_run_id
    row.last_runtime_plan_hash = test_run.runtime_plan_hash
    row.last_run_at = finished_at
    row.updated_at = finished_at


async def _run_case(
    row: AgentTestCase,
    session: Session,
    org_id: str,
    suite_run_id: str | None = None,
    actor_user_id: str | None = None,
    actor_role: str = "editor",
    runtime_plan_hash: str | None = None,
    preview: bool = True,
) -> AgentTestRun:
    conversation_id = f"evaluation:{row.id}:{new_id('runctx')}"
    started = perf_counter()
    if runtime_plan_hash is None:
        agent = get_agent_or_404(session, row.agent_id, org_id)
        runtime_plan = build_runtime_plan(agent, session, org_id, preview=preview)
        runtime_plan_hash = runtime_plan.spec_hash if runtime_plan else ""
    test_run = AgentTestRun(
        id=new_id("testrun"),
        org_id=org_id,
        agent_id=row.agent_id,
        case_id=row.id,
        suite_run_id=suite_run_id,
        conversation_id=conversation_id,
        runtime_plan_hash=runtime_plan_hash,
        case_name=row.name,
        input_text=row.input_text,
        expected_keywords_json=row.expected_keywords_json,
        assertion_json=row.assertion_json,
    )
    session.add(test_run)
    session.commit()
    try:
        request = responses_to_execution(
            session,
            org_id,
            ResponsesRequest(
                model=f"agent:{row.agent_id}",
                input=row.input_text,
                metadata={"conversation_id": conversation_id},
            ),
        ).model_copy(update={"preview": preview})
        run_label = "配置验收" if preview else "上线版本回归"
        result = await ExecutionGateway(
            AgentExecutionService(session, org_id=org_id, actor_role=actor_role, actor_user_id=actor_user_id)
        ).execute_once(
            request,
            ExecutionGatewayOptions(
                source="test_case_preview" if preview else "test_case_release",
                entrypoint="responses",
                trace_label=f"{run_label}用例运行",
                done_label=f"{run_label}用例完成",
                error_label=f"{run_label}用例失败",
            ),
        )
        output = result.output_text
        run = _latest_case_run(session, row.agent_id, conversation_id, org_id)
        errors = _assert_case(session, row, output, run)
        test_run.agent_run_id = run.id if run else None
        test_run.runtime_plan_hash = run.spec_hash if run else runtime_plan_hash
        test_run.status = "passed" if not errors else "failed"
        test_run.output = output[:4000]
        test_run.error = "" if not errors else "；".join(errors)[:1000]
        test_run.assertion_errors_json = _dumps(errors)
        test_run.duration_ms = int((perf_counter() - started) * 1000)
    except Exception as exc:
        run = _latest_case_run(session, row.agent_id, conversation_id, org_id)
        test_run.agent_run_id = run.id if run else None
        test_run.runtime_plan_hash = run.spec_hash if run else runtime_plan_hash
        test_run.status = "error"
        test_run.output = ""
        test_run.error = str(exc)[:1000]
        test_run.assertion_errors_json = _dumps([str(exc)[:1000]])
        test_run.duration_ms = int((perf_counter() - started) * 1000)
    finished_at = now_iso()
    test_run.ended_at = finished_at
    _cache_case_result(row, test_run, finished_at)
    session.add(test_run)
    session.add(row)
    session.commit()
    session.refresh(test_run)
    return test_run


@router.get("/agents/{agent_id}", response_model=List[AgentTestCaseRead])
def list_agent_test_cases(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[AgentTestCaseRead]:
    org_id = context.organization.id
    get_agent_or_404(session, agent_id, org_id)
    stmt = (
        select(AgentTestCase)
        .where(AgentTestCase.agent_id == agent_id, AgentTestCase.org_id == org_id)
        .order_by(AgentTestCase.created_at.desc())
    )
    return [_to_read(row) for row in session.exec(stmt).all()]


@router.post("/agents/{agent_id}", response_model=AgentTestCaseRead)
def create_agent_test_case(
    agent_id: str,
    payload: AgentTestCaseCreate,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestCaseRead:
    org_id = context.organization.id
    get_agent_or_404(session, agent_id, org_id)
    row = AgentTestCase(
        id=new_id("case"),
        org_id=org_id,
        agent_id=agent_id,
        name=payload.name,
        input_text=payload.input_text,
        expected_keywords_json=_dumps(payload.expected_keywords),
        assertion_json=_dumps(payload.assertion),
        status=payload.status,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _to_read(row)


@router.put("/{case_id}", response_model=AgentTestCaseRead)
def update_agent_test_case(
    case_id: str,
    payload: AgentTestCaseUpdate,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestCaseRead:
    row = get_test_case_or_404(session, case_id, context.organization.id)
    updates = payload.model_dump(exclude_unset=True)
    if "expected_keywords" in updates:
        row.expected_keywords_json = _dumps(payload.expected_keywords or [])
        updates.pop("expected_keywords")
    if "assertion" in updates:
        row.assertion_json = _dumps(payload.assertion or {})
        updates.pop("assertion")
    should_reset_result = bool(
        {"input_text", "expected_keywords", "assertion", "status"}.intersection(payload.model_dump(exclude_unset=True))
    )
    for key, value in updates.items():
        setattr(row, key, value)
    if should_reset_result:
        row.last_status = "untested"
        row.last_output = ""
        row.last_error = ""
        row.last_run_id = None
        row.last_runtime_plan_hash = ""
        row.last_run_at = None
    row.updated_at = now_iso()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _to_read(row)


@router.get("/{case_id}/runs", response_model=List[AgentTestRunRead])
def list_agent_test_runs(
    case_id: str,
    limit: int = 20,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[AgentTestRunRead]:
    row = get_test_case_or_404(session, case_id, context.organization.id)
    stmt = (
        select(AgentTestRun)
        .where(AgentTestRun.case_id == row.id, AgentTestRun.org_id == row.org_id)
        .order_by(AgentTestRun.started_at.desc())
        .limit(min(limit, 100))
    )
    return [_test_run_to_read(item) for item in session.exec(stmt).all()]


@router.get("/agents/{agent_id}/suite-runs", response_model=List[AgentTestSuiteRunRead])
def list_agent_test_suite_runs(
    agent_id: str,
    limit: int = 20,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[AgentTestSuiteRunRead]:
    org_id = context.organization.id
    get_agent_or_404(session, agent_id, org_id)
    rows = session.exec(
        select(AgentTestSuiteRun)
        .where(AgentTestSuiteRun.agent_id == agent_id, AgentTestSuiteRun.org_id == org_id)
        .order_by(AgentTestSuiteRun.started_at.desc())
        .limit(min(limit, 100))
    ).all()
    return [_suite_run_to_read(row, cases=[], runs=[]) for row in rows]


@router.post("/{case_id}/run-preview", response_model=AgentTestRunRead)
async def run_agent_test_case_preview(
    case_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestRunRead:
    org_id = context.organization.id
    row = get_test_case_or_404(session, case_id, org_id)
    get_agent_or_404(session, row.agent_id, org_id)

    return _test_run_to_read(await _run_case(
        row,
        session,
        org_id,
        actor_user_id=context.user.id,
        actor_role=context.membership.role,
        preview=True,
    ))


@router.post("/{case_id}/run-release", response_model=AgentTestRunRead)
async def run_agent_test_case_release(
    case_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestRunRead:
    org_id = context.organization.id
    row = get_test_case_or_404(session, case_id, org_id)
    get_agent_or_404(session, row.agent_id, org_id)

    return _test_run_to_read(await _run_case(
        row,
        session,
        org_id,
        actor_user_id=context.user.id,
        actor_role=context.membership.role,
        preview=False,
    ))


@router.post("/agents/{agent_id}/run-preview-all", response_model=AgentTestSuiteRunRead)
async def run_agent_test_suite_preview(
    agent_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestSuiteRunRead:
    return await _run_agent_test_suite(agent_id, context, session, preview=True)


@router.post("/agents/{agent_id}/run-release-all", response_model=AgentTestSuiteRunRead)
async def run_agent_test_suite_release(
    agent_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestSuiteRunRead:
    return await _run_agent_test_suite(agent_id, context, session, preview=False)


async def _run_agent_test_suite(
    agent_id: str,
    context: AuthContext,
    session: Session,
    *,
    preview: bool,
) -> AgentTestSuiteRunRead:
    org_id = context.organization.id
    agent = get_agent_or_404(session, agent_id, org_id)
    rows = session.exec(
        select(AgentTestCase)
        .where(AgentTestCase.agent_id == agent_id, AgentTestCase.org_id == org_id, AgentTestCase.status == "active")
        .order_by(AgentTestCase.created_at.asc())
    ).all()
    suite_started = perf_counter()
    runtime_plan = build_runtime_plan(agent, session, org_id, preview=preview)
    runtime_plan_hash = runtime_plan.spec_hash if runtime_plan else ""
    suite_run = AgentTestSuiteRun(
        id=new_id("suiterun"),
        org_id=org_id,
        agent_id=agent_id,
        runtime_plan_hash=runtime_plan_hash,
        total=len(rows),
    )
    session.add(suite_run)
    session.commit()
    results = [
        await _run_case(
            row,
            session,
            org_id,
            suite_run_id=suite_run.id,
            actor_user_id=context.user.id,
            actor_role=context.membership.role,
            runtime_plan_hash=runtime_plan_hash,
            preview=preview,
        )
        for row in rows
    ]
    suite_run.passed = sum(1 for item in results if item.status == "passed")
    suite_run.failed = sum(1 for item in results if item.status in {"failed", "error"})
    suite_run.status = "completed" if suite_run.failed == 0 else "failed"
    suite_run.duration_ms = int((perf_counter() - suite_started) * 1000)
    suite_run.ended_at = now_iso()
    session.add(suite_run)
    session.commit()
    session.refresh(suite_run)
    case_reads = []
    for row in rows:
        session.refresh(row)
        case_reads.append(_to_read(row))
    return _suite_run_to_read(
        suite_run,
        cases=case_reads,
        runs=[_test_run_to_read(item) for item in results],
    )


@router.delete("/{case_id}")
def delete_agent_test_case(
    case_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    row = get_test_case_or_404(session, case_id, context.organization.id)
    delete_test_case_resources(session, row)
    return {"status": "deleted"}
