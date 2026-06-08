from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import Skill, SkillVersion, new_id, now_iso
from app.core.schemas import (
    SkillCreate,
    SkillExportRead,
    SkillHealthRead,
    SkillImpactRead,
    SkillImportPreviewRead,
    SkillImportRequest,
    SkillRead,
    SkillRuntimePreviewRead,
    SkillUpdate,
    SkillVersionDiffRead,
    SkillVersionRead,
)
from app.db.session import get_session
from app.services.mappers import _dumps, _loads
from app.services.skill_governance_service import skill_deletion_usage, skill_deletion_usage_detail
from app.services.skill_service import (
    export_skill_package,
    diff_skill_version,
    import_skill_package,
    list_skill_versions,
    preview_skill_import,
    publish_skill_version,
    restore_skill_version,
    skill_impact,
    skill_runtime_preview,
    skill_to_read,
    validate_allowed_tools,
)
from app.services.skill_health_service import build_skill_health, build_skills_health
from app.services.tenant_scope import get_skill_or_404

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=List[SkillRead])
def list_skills(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[SkillRead]:
    rows = session.exec(
        select(Skill)
        .where(Skill.org_id == context.organization.id)
        .order_by(Skill.updated_at.desc())
    ).all()
    return [skill_to_read(row) for row in rows]


@router.get("/health", response_model=List[SkillHealthRead])
def skills_health(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[SkillHealthRead]:
    rows = session.exec(
        select(Skill)
        .where(Skill.org_id == context.organization.id)
        .order_by(Skill.updated_at.desc())
    ).all()
    return build_skills_health(rows, session)


@router.post("/import", response_model=SkillRead)
def import_skill(
    payload: SkillImportRequest,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> SkillRead:
    try:
        return import_skill_package(
            session=session,
            package=payload.package,
            overwrite=payload.overwrite,
            preserve_id=payload.preserve_id,
            org_id=context.organization.id,
            actor_role=context.membership.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/preview", response_model=SkillImportPreviewRead)
def preview_import(
    payload: SkillImportRequest,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillImportPreviewRead:
    try:
        return preview_skill_import(session=session, package=payload.package, org_id=context.organization.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{skill_id}", response_model=SkillRead)
def get_skill(
    skill_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    return skill_to_read(row)


@router.get("/{skill_id}/versions", response_model=List[SkillVersionRead])
def versions(
    skill_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[SkillVersionRead]:
    get_skill_or_404(session, skill_id, context.organization.id)
    return list_skill_versions(session, skill_id, context.organization.id)


@router.get("/{skill_id}/runtime-preview", response_model=SkillRuntimePreviewRead)
def runtime_preview(
    skill_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillRuntimePreviewRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    return skill_runtime_preview(session, row)


@router.get("/{skill_id}/health", response_model=SkillHealthRead)
def health(
    skill_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillHealthRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    return build_skill_health(row, session)


@router.get("/{skill_id}/impact", response_model=SkillImpactRead)
def impact(
    skill_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillImpactRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    return skill_impact(session, row)


@router.post("/{skill_id}/versions", response_model=SkillVersionRead)
def publish_version(
    skill_id: str,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> SkillVersionRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    try:
        validate_allowed_tools(session, _loads(row.allowed_tools_json, []), context.organization.id, context.membership.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return publish_skill_version(session, row)


@router.post("/{skill_id}/versions/{version}/restore", response_model=SkillRead)
def restore_version(
    skill_id: str,
    version: int,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> SkillRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    version_row = session.exec(
        select(SkillVersion).where(
            SkillVersion.skill_id == skill_id,
            SkillVersion.org_id == context.organization.id,
            SkillVersion.version == version,
        )
    ).first()
    if not version_row:
        raise HTTPException(status_code=404, detail="能力版本不存在")
    try:
        validate_allowed_tools(
            session,
            _loads(version_row.allowed_tools_json, []),
            context.organization.id,
            context.membership.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return restore_skill_version(session, row, version_row)


@router.get("/{skill_id}/versions/{version}/diff", response_model=SkillVersionDiffRead)
def version_diff(
    skill_id: str,
    version: int,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillVersionDiffRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    version_row = session.exec(
        select(SkillVersion).where(
            SkillVersion.skill_id == skill_id,
            SkillVersion.org_id == context.organization.id,
            SkillVersion.version == version,
        )
    ).first()
    if not version_row:
        raise HTTPException(status_code=404, detail="能力版本不存在")
    return diff_skill_version(session, row, version_row)


@router.get("/{skill_id}/export", response_model=SkillExportRead)
def export_skill(
    skill_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> SkillExportRead:
    row = get_skill_or_404(session, skill_id, context.organization.id)
    return export_skill_package(session, row)


@router.post("", response_model=SkillRead)
def create_skill(
    payload: SkillCreate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> SkillRead:
    org_id = context.organization.id
    existing = session.exec(select(Skill).where(Skill.name == payload.name, Skill.org_id == org_id)).first()
    if existing:
        raise HTTPException(status_code=409, detail="能力名称已存在")
    try:
        validate_allowed_tools(session, payload.allowed_tools, org_id, context.membership.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = Skill(
        id=new_id("skill"),
        org_id=org_id,
        name=payload.name,
        display_name=payload.display_name,
        description=payload.description,
        instructions=payload.instructions,
        allowed_tools_json=_dumps(payload.allowed_tools),
        metadata_json=_dumps(payload.metadata),
        status=payload.status,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    publish_skill_version(session, row)
    return skill_to_read(row)


@router.put("/{skill_id}", response_model=SkillRead)
def update_skill(
    skill_id: str,
    payload: SkillUpdate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> SkillRead:
    org_id = context.organization.id
    row = get_skill_or_404(session, skill_id, org_id)
    updates = payload.model_dump(exclude_unset=True)
    if "allowed_tools" in updates:
        try:
            validate_allowed_tools(session, payload.allowed_tools or [], org_id, context.membership.role)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        row.allowed_tools_json = _dumps(payload.allowed_tools or [])
        updates.pop("allowed_tools")
    if "metadata" in updates:
        row.metadata_json = _dumps(payload.metadata or {})
        updates.pop("metadata")
    for key, value in updates.items():
        setattr(row, key, value)
    row.version += 1
    row.updated_at = now_iso()
    session.add(row)
    session.commit()
    session.refresh(row)
    return skill_to_read(row)


@router.delete("/{skill_id}")
def delete_skill(
    skill_id: str,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    org_id = context.organization.id
    row = get_skill_or_404(session, skill_id, org_id)
    usage = skill_deletion_usage(skill_id, session, org_id)
    if usage.total:
        raise HTTPException(status_code=409, detail=skill_deletion_usage_detail(usage))
    versions = session.exec(
        select(SkillVersion).where(SkillVersion.skill_id == skill_id, SkillVersion.org_id == org_id)
    ).all()
    for version in versions:
        session.delete(version)
    session.delete(row)
    session.commit()
    return {"status": "deleted"}
