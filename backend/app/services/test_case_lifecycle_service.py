from dataclasses import dataclass

from sqlmodel import Session, select

from app.core.models import AgentTestCase, AgentTestRun


@dataclass(frozen=True)
class TestCaseDeleteResult:
    deleted_test_runs: int = 0


def delete_test_case_resources(session: Session, test_case: AgentTestCase) -> TestCaseDeleteResult:
    runs = session.exec(
        select(AgentTestRun).where(
            AgentTestRun.org_id == test_case.org_id,
            AgentTestRun.case_id == test_case.id,
        )
    ).all()
    for row in runs:
        session.delete(row)
    session.delete(test_case)
    session.commit()
    return TestCaseDeleteResult(deleted_test_runs=len(runs))
