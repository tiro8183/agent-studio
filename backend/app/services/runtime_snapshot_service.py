import hashlib
import json
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.core.models import Agent, AgentReleaseSnapshot, KnowledgeDocument, LLMConfig, Skill, ToolDefinition, new_id
from app.services.knowledge_chunk_service import list_document_chunks
from app.services.llm_runtime_contract import snapshot_llm_config
from app.services.mappers import _dumps, _loads, agent_to_read
from app.services.runtime_capabilities import tool_ids_for_runtime, unique_resource_ids
from app.services.runtime_manifest_service import build_runtime_manifest_from_spec
from app.services.knowledge_retrieval_service import KnowledgeSource, content_hash, snapshot_chunks
from app.services.tool_governance import metadata_for_snapshot


def build_agent_spec(agent: Agent) -> dict[str, Any]:
    agent_spec = agent_to_read(agent).model_dump(mode="json")
    for key in ("slug", "current_spec_hash", "latest_release_spec_hash", "config_pending_publish"):
        agent_spec.pop(key, None)
    return agent_spec


def build_runtime_spec(agent: Agent, session: Session, strict_llm_contract: bool = False) -> dict[str, Any]:
    agent_spec = build_agent_spec(agent)
    skill_snapshots = _skill_snapshots(agent_spec, session)
    skill_allowed_tools = {
        item["id"]: [str(tool_id) for tool_id in item.get("allowed_tools", []) if tool_id]
        for item in skill_snapshots
        if item.get("status") == "active"
    }
    tool_ids = _runtime_tool_ids(agent_spec, skill_allowed_tools)
    tool_snapshots = _tool_snapshots(tool_ids, session, agent.org_id)
    llm_snapshots = _llm_snapshots(agent_spec, session, strict=strict_llm_contract)
    knowledge_snapshots = _knowledge_snapshots(agent, session)
    return {
        "schema_version": 1,
        "agent": agent_spec,
        "llm_configs": llm_snapshots,
        "skills": skill_snapshots,
        "tools": tool_snapshots,
        "knowledge": knowledge_snapshots,
    }


def create_release_snapshot(agent: Agent, session: Session, version: int, published_at: str) -> AgentReleaseSnapshot:
    from app.services.runtime_plan_service import build_publish_runtime_plan, create_release_snapshot_from_plan

    plan = build_publish_runtime_plan(agent, session, version, published_at)
    return create_release_snapshot_from_plan(plan, session)


def latest_release_snapshot(session: Session, agent_id: str, org_id: str) -> AgentReleaseSnapshot | None:
    return session.exec(
        select(AgentReleaseSnapshot)
        .where(
            AgentReleaseSnapshot.agent_id == agent_id,
            AgentReleaseSnapshot.org_id == org_id,
            AgentReleaseSnapshot.status == "published",
        )
        .order_by(AgentReleaseSnapshot.version.desc())
        .limit(1)
    ).first()


def runtime_spec_from_release(snapshot: AgentReleaseSnapshot) -> dict[str, Any]:
    return _loads(snapshot.runtime_spec_json, {})


def manifest_json_from_runtime_spec(runtime_spec: dict[str, Any]) -> str:
    return _dumps(build_runtime_manifest_from_spec(runtime_spec))


def _runtime_tool_ids(agent_spec: dict[str, Any], skill_allowed_tools: dict[str, list[str]]) -> list[str]:
    tools = list(agent_spec.get("tools") or [])
    skills = list(agent_spec.get("skills") or [])
    tool_ids = tool_ids_for_runtime(tools, skills, skill_allowed_tools)
    for subagent in agent_spec.get("subagents") or []:
        tool_ids.extend(
            tool_ids_for_runtime(
                list(subagent.get("tools") or []),
                list(subagent.get("skills") or []),
                skill_allowed_tools,
            )
        )
    return unique_resource_ids(tool_ids)


def _skill_snapshots(agent_spec: dict[str, Any], session: Session) -> list[dict[str, Any]]:
    skill_ids = list(agent_spec.get("skills") or [])
    for subagent in agent_spec.get("subagents") or []:
        skill_ids.extend(subagent.get("skills") or [])
    ids = unique_resource_ids(skill_ids)
    if not ids:
        return []
    org_id = str(agent_spec.get("org_id") or "org_default")
    rows = session.exec(select(Skill).where(Skill.id.in_(ids), Skill.org_id == org_id)).all()
    row_map = {row.id: row for row in rows}
    return [
        {
            "id": row.id,
            "org_id": row.org_id,
            "name": row.name,
            "display_name": row.display_name,
            "description": row.description,
            "instructions": row.instructions,
            "allowed_tools": _loads(row.allowed_tools_json, []),
            "metadata": _loads(row.metadata_json, {}),
            "version": row.version,
            "status": row.status,
        }
        for skill_id in ids
        if (row := row_map.get(skill_id))
    ]


def _tool_snapshots(tool_ids: list[str], session: Session, org_id: str) -> list[dict[str, Any]]:
    ids = unique_resource_ids(tool_ids)
    if not ids:
        return []
    rows = session.exec(
        select(ToolDefinition).where(
            ToolDefinition.id.in_(ids),
            (ToolDefinition.org_id == org_id) | (ToolDefinition.implementation == "builtin"),
        )
    ).all()
    row_map = {row.id: row for row in rows}
    return [
        {
            "id": row.id,
            "org_id": row.org_id,
            "name": row.name,
            "description": row.description,
            "category": row.category,
            "implementation": row.implementation,
            "metadata": metadata_for_snapshot(_loads(row.metadata_json, {})),
            "status": row.status,
        }
        for tool_id in ids
        if (row := row_map.get(tool_id))
    ]


def _llm_snapshots(agent_spec: dict[str, Any], session: Session, strict: bool = False) -> list[dict[str, Any]]:
    org_id = str(agent_spec.get("org_id") or "org_default")
    ids = [str(agent_spec.get("llm_config_id") or "").strip()]
    for subagent in agent_spec.get("subagents") or []:
        ids.append(str(subagent.get("llm_config_id") or agent_spec.get("llm_config_id") or "").strip())
    llm_ids = unique_resource_ids([item for item in ids if item])
    if not llm_ids:
        return []
    rows = session.exec(select(LLMConfig).where(LLMConfig.id.in_(llm_ids), LLMConfig.org_id == org_id)).all()
    row_map = {row.id: row for row in rows}
    if strict:
        missing = [llm_id for llm_id in llm_ids if llm_id not in row_map]
        inactive = [row.id for row in row_map.values() if row.status != "active"]
        if missing:
            raise ValueError(f"上线版本缺少模型通道配置: {', '.join(missing)}")
        if inactive:
            raise ValueError(f"上线版本引用了未启用模型通道: {', '.join(inactive)}")
    return [
        snapshot_llm_config(row)
        for llm_id in llm_ids
        if (row := row_map.get(llm_id))
    ]


def _knowledge_snapshots(agent: Agent, session: Session) -> list[dict[str, Any]]:
    rows = session.exec(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.agent_id == agent.id, KnowledgeDocument.org_id == agent.org_id)
        .order_by(KnowledgeDocument.created_at.desc())
    ).all()
    return [_knowledge_snapshot(row, session) for row in rows]


def _knowledge_snapshot(row: KnowledgeDocument, session: Session) -> dict[str, Any]:
    content_text = ""
    persisted_chunks = list_document_chunks(session, row.org_id, row.id)
    try:
        path = Path(row.file_path)
        if path.exists() and not persisted_chunks:
            content_text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        content_text = ""
    if persisted_chunks:
        hash_value = persisted_chunks[0].content_hash if persisted_chunks else ""
        chunk_source = "persisted_chunks"
        chunk_snapshots = [
            {
                "document_id": chunk.document_id,
                "file_name": chunk.file_name,
                "chunk_id": chunk.id,
                "ordinal": chunk.ordinal,
                "text": chunk.text,
                "content_hash": chunk.content_hash,
                "char_count": chunk.char_count,
            }
            for chunk in persisted_chunks
        ]
        snapshot_size = sum(len(chunk.text.encode("utf-8")) for chunk in persisted_chunks)
        char_count = sum(chunk.char_count for chunk in persisted_chunks)
        content_text = ""
    else:
        hash_value = content_hash(content_text)
        chunk_source = "live_file_fallback"
        source = KnowledgeSource(
            id=row.id,
            file_name=row.file_name,
            content_text=content_text,
            content_hash=hash_value,
            content_type=row.content_type,
            created_at=row.created_at,
        )
        chunk_snapshots = snapshot_chunks(source)
        snapshot_size = len(content_text.encode("utf-8"))
        char_count = len(content_text)
    return {
        "id": row.id,
        "file_name": row.file_name,
        "content_type": row.content_type,
        "size": row.size,
        "snapshot_size": snapshot_size,
        "char_count": char_count,
        "content_hash": hash_value,
        "content_text": content_text,
        "chunks": chunk_snapshots,
        "chunk_count": len(chunk_snapshots),
        "chunk_source": chunk_source,
        "created_at": row.created_at,
    }


def _spec_hash(runtime_spec: dict[str, Any]) -> str:
    canonical = json.dumps(_semantic_runtime_spec(runtime_spec), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def spec_hash_for_runtime_spec(runtime_spec: dict[str, Any]) -> str:
    return _spec_hash(runtime_spec)


def _semantic_runtime_spec(runtime_spec: dict[str, Any]) -> dict[str, Any]:
    spec = json.loads(json.dumps(runtime_spec, ensure_ascii=False))
    agent = spec.get("agent")
    if isinstance(agent, dict):
        for key in ("status", "version", "published_at", "created_at", "updated_at"):
            agent.pop(key, None)
    for item in spec.get("knowledge") or []:
        if isinstance(item, dict):
            item.pop("created_at", None)
    return spec
