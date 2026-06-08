from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import AuthContext, get_current_context
from app.core.schemas import (
    AgentStudioWorkspaceRead,
    AssetGovernanceRead,
    CommandCenterRead,
    OperationsWorkspaceRead,
    RunEvidenceWorkspaceRead,
)
from app.db.session import get_session
from app.services.workspace_view_service import (
    agent_studio_workspace_view,
    asset_governance_view,
    command_center_view,
    operations_workspace_view,
    run_evidence_workspace_view,
)

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("/command-center", response_model=CommandCenterRead)
def command_center(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> CommandCenterRead:
    return command_center_view(session, context.organization.id, context.organization.name)


@router.get("/agent-studio", response_model=AgentStudioWorkspaceRead)
def agent_studio(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentStudioWorkspaceRead:
    return agent_studio_workspace_view(session, context.organization.id)


@router.get("/asset-governance", response_model=AssetGovernanceRead)
def asset_governance(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AssetGovernanceRead:
    return asset_governance_view(session, context.organization.id)


@router.get("/run-evidence", response_model=RunEvidenceWorkspaceRead)
def run_evidence(
    limit: int = 30,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RunEvidenceWorkspaceRead:
    return run_evidence_workspace_view(session, context.organization.id, limit=limit)


@router.get("/operations", response_model=OperationsWorkspaceRead)
def operations(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> OperationsWorkspaceRead:
    return operations_workspace_view(session, context.organization.id)
