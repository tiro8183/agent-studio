from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import AuthContext, get_current_context
from app.core.schemas import RegressionQualityOverviewRead
from app.db.session import get_session
from app.services.regression_quality_service import build_regression_quality_overview

router = APIRouter(prefix="/quality", tags=["quality"])


@router.get("/regression-overview", response_model=RegressionQualityOverviewRead)
def get_regression_quality_overview(
    limit: int = 80,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RegressionQualityOverviewRead:
    return build_regression_quality_overview(
        session,
        context.organization.id,
        limit=min(max(limit, 1), 200),
    )
