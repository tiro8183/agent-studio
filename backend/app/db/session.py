from collections.abc import Generator
import json

from sqlmodel import Session, create_engine, select

from app.config import settings
from app.core.models import (
    ApiToken,
    Agent,
    AgentReleaseSnapshot,
    AgentTestCase,
    AuditLog,
    KnowledgeChunkRecord,
    KnowledgeDocument,
    KnowledgeRetrievalAudit,
    LLMInvocationLog,
    LLMConfig,
    Organization,
    OrganizationMember,
    Skill,
    SkillVersion,
    ToolDefinition,
    ToolInvocationAudit,
    ToolSecret,
    User,
    now_iso,
)
from app.services.security import hash_password
from app.services.agent_slug_service import unique_slug_for_agent

DEFAULT_ORG_ID = "org_default"
BOOTSTRAP_USER_ID = "user_admin"
BOOTSTRAP_MEMBER_ID = "member_admin_default"
DEMO_AGENT_ID = "agent_demo_default"
DEMO_AGENT_SLUG = "business-material-reviewer"
DEMO_AGENT_NAME = "业务资料核验专员"
DEMO_AGENT_DESCRIPTION = "用于核验业务材料、整理风险点和生成复核清单的示例服务"
DEMO_AGENT_SYSTEM_PROMPT = (
    "你是一个严谨的业务资料核验专员，请基于用户提供的材料提取关键事实、风险点和待复核事项。"
)
DEMO_AGENT_METADATA_JSON = (
    '{"service_catalog":{"domain":"业务合规","department":"运营治理团队","owner":"运营治理团队",'
    '"service_level":"工作日支持","caller_scope":"组织内授权成员",'
    '"sample_prompts":["请核验这份业务材料的风险点，并输出复核清单。",'
    '"请根据以下材料整理关键事实、缺失信息和后续处理建议。"]}}'
)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)


def initialize_database() -> None:
    from app.db.migrations import run_database_migrations

    run_database_migrations()
    seed_demo_data()


def seed_demo_data() -> None:
    with Session(engine) as session:
        ensure_bootstrap_identity(session)
        has_agent = session.exec(select(Agent).limit(1)).first()
        if has_agent:
            ensure_demo_skill(session)
            ensure_builtin_tools(session)
            ensure_demo_agent_profile(session)
            ensure_demo_regression_cases(session)
            ensure_published_agent_snapshots(session)
            return

        llm = LLMConfig(
            id="llm_demo_openai_compatible",
            org_id=DEFAULT_ORG_ID,
            name="示例自定义模型通道",
            provider_type="custom",
            api_key="",
            base_url="http://localhost:9999/v1",
            available_models_json='[{"name":"your-model-id","is_reasoning_model":false}]',
            default_model="your-model-id",
            temperature=0.7,
            max_tokens=1024,
        )
        agent = Agent(
            id=DEMO_AGENT_ID,
            org_id=DEFAULT_ORG_ID,
            name=DEMO_AGENT_NAME,
            slug=DEMO_AGENT_SLUG,
            description=DEMO_AGENT_DESCRIPTION,
            system_prompt=DEMO_AGENT_SYSTEM_PROMPT,
            llm_config_id=llm.id,
            model="your-model-id",
            status="published",
            tools_json='["current_time","word_count"]',
            skills_json='["skill_demo_planning"]',
            memory_json='["默认优先给出结构化、可执行的答案。"]',
            runtime_json='{"backend_type":"filesystem","debug":false,"checkpointing":false,"interrupt_on":{}}',
            output_json='{"mode":"text","json_schema":{}}',
            subagents_json=(
                '[{"name":"planner","description":"负责拆解任务、产出步骤和风险点",'
                '"system_prompt":"你是任务规划子代理。你要把用户目标拆成清晰步骤、识别依赖和风险，并给出可执行清单。",'
                '"tools":["checklist"],"skills":["skill_demo_planning"],"memory":[],"model":null,'
                '"interrupt_on":{},"permissions":null,"output":{"mode":"text","json_schema":{}}},'
                '{"name":"analyst","description":"负责文本分析和摘要",'
                '"system_prompt":"你是文本分析子代理。你要提取关键信息、统计文本特征，并给出结构化结论。",'
                '"tools":["word_count"],"skills":[],"memory":[],"model":null,'
                '"interrupt_on":{},"permissions":null,"output":{"mode":"text","json_schema":{}}}]'
            ),
            routing_json='{"fixed_replies":[{"keywords":["ping"],"reply":"pong"}]}',
            metadata_json=DEMO_AGENT_METADATA_JSON,
            published_at=now_iso(),
        )
        session.add(llm)
        ensure_builtin_tools(session)
        session.add(demo_planning_skill())
        session.add(agent)
        session.commit()
        demo_skill = session.get(Skill, "skill_demo_planning")
        if demo_skill:
            ensure_skill_version(session, demo_skill)
        session.add(
            AgentTestCase(
                id="case_demo_ping",
                org_id=DEFAULT_ORG_ID,
                agent_id=agent.id,
                name="固定回复冒烟测试",
                input_text="ping",
                expected_keywords_json='["pong"]',
            )
        )
        session.commit()

        text_content = (
            "Agent Studio 面向 Agent 的设计、上线和运行。\n"
            "平台围绕 Agent、知识资料、运行证据和验收样本形成闭环。\n"
        )
        from app.services.upload_resource_service import build_upload_target

        knowledge_path = build_upload_target(
            org_id=DEFAULT_ORG_ID,
            resource_type="knowledge",
            resource_id=agent.id,
            record_id="kb_demo_intro",
            file_name="demo-agent-forge-knowledge.txt",
        )
        knowledge_path.write_text(text_content, encoding="utf-8")
        session.add(
            KnowledgeDocument(
                id="kb_demo_intro",
                org_id=DEFAULT_ORG_ID,
                agent_id=agent.id,
                file_name=knowledge_path.name,
                file_path=str(knowledge_path),
                content_type="text/plain",
                size=len(text_content.encode("utf-8")),
                char_count=len(text_content),
                preview=text_content[:240],
            )
        )
        session.commit()
        demo_document = session.get(KnowledgeDocument, "kb_demo_intro")
        if demo_document:
            from app.services.knowledge_chunk_service import persist_document_chunks

            persist_document_chunks(session, demo_document, text_content)
            session.commit()
        ensure_published_agent_snapshots(session)


def ensure_demo_agent_profile(session: Session) -> None:
    candidates = []
    seen_ids = set()
    agent = session.get(Agent, DEMO_AGENT_ID)
    if agent:
        candidates.append(agent)
        seen_ids.add(agent.id)
    legacy_agents = session.exec(
        select(Agent).where(
            Agent.name == "默认助手",
            Agent.description == "用于验证平台基础链路的示例智能体",
        )
    ).all()
    for item in legacy_agents:
        if item.id in seen_ids:
            continue
        candidates.append(item)
        seen_ids.add(item.id)

    changed = False
    for candidate in candidates:
        candidate_changed = False
        if not candidate.slug:
            candidate.slug = unique_slug_for_agent(
                session,
                candidate.org_id,
                candidate.id,
                candidate.name,
                DEMO_AGENT_SLUG if candidate.id == DEMO_AGENT_ID else None,
            )
            candidate_changed = True
        if candidate.name == "默认助手":
            candidate.name = DEMO_AGENT_NAME
            candidate_changed = True
        if candidate.description == "用于验证平台基础链路的示例智能体":
            candidate.description = DEMO_AGENT_DESCRIPTION
            candidate_changed = True
        if candidate.system_prompt == "你是一个简洁可靠的助手。":
            candidate.system_prompt = DEMO_AGENT_SYSTEM_PROMPT
            candidate_changed = True
        if not candidate.metadata_json or candidate.metadata_json == "{}":
            candidate.metadata_json = DEMO_AGENT_METADATA_JSON
            candidate_changed = True
        if candidate_changed:
            changed = True
            candidate.updated_at = now_iso()
            session.add(candidate)
    if changed:
        session.commit()


def ensure_demo_regression_cases(session: Session) -> None:
    demo_case_names = {"平台能力演示回归", "固定回复冒烟测试"}
    rows = session.exec(
        select(AgentTestCase).where(
            AgentTestCase.org_id == DEFAULT_ORG_ID,
            AgentTestCase.name.in_(demo_case_names),
        )
    ).all()
    changed = False
    for row in rows:
        try:
            assertion = json.loads(row.assertion_json or "{}")
        except json.JSONDecodeError:
            assertion = {}
        desired_assertion = {
            **assertion,
            "required_keywords": json.loads(row.expected_keywords_json or "[]"),
            "required_tools": [],
            "required_subagents": [],
            "required_event_types": [],
        }
        desired_assertion.pop("max_duration_ms", None)
        desired_json = json.dumps(desired_assertion, ensure_ascii=False, separators=(",", ":"))
        if row.assertion_json != desired_json:
            row.assertion_json = desired_json
            row.last_status = "untested"
            row.last_error = ""
            row.last_output = ""
            row.last_run_id = None
            row.last_runtime_plan_hash = ""
            row.last_run_at = None
            row.updated_at = now_iso()
            session.add(row)
            changed = True
    if changed:
        session.commit()


def ensure_bootstrap_identity(session: Session) -> None:
    email = settings.bootstrap_email.strip().lower()
    org = session.exec(select(Organization).where(Organization.slug == "default")).first() or session.get(
        Organization,
        DEFAULT_ORG_ID,
    )
    if not org:
        org = Organization(
            id=DEFAULT_ORG_ID,
            name=settings.bootstrap_org_name,
            slug="default",
        )
        session.add(org)
        session.commit()

    user_by_id = session.get(User, BOOTSTRAP_USER_ID)
    user_by_email = session.exec(select(User).where(User.email == email)).first()
    user = user_by_email or user_by_id
    if not user:
        user = User(
            id=BOOTSTRAP_USER_ID,
            email=email,
            display_name="Administrator",
            password_hash=hash_password(settings.bootstrap_password),
        )
        session.add(user)
        session.commit()
    elif user.id == BOOTSTRAP_USER_ID:
        changed = False
        if user.email != email and not user_by_email:
            user.email = email
            changed = True
        if settings.env == "development":
            user.password_hash = hash_password(settings.bootstrap_password)
            changed = True
        if changed:
            user.updated_at = now_iso()
            session.add(user)
            session.commit()

    member = session.exec(
        select(OrganizationMember).where(
            OrganizationMember.org_id == org.id,
            OrganizationMember.user_id == user.id,
        )
    ).first()
    if not member:
        member_by_id = session.get(OrganizationMember, BOOTSTRAP_MEMBER_ID)
        if member_by_id:
            member_by_id.org_id = org.id
            member_by_id.user_id = user.id
            member_by_id.role = "owner"
            member_by_id.status = "active"
            member_by_id.updated_at = now_iso()
            session.add(member_by_id)
            session.commit()
            return
        session.add(
            OrganizationMember(
                id=BOOTSTRAP_MEMBER_ID,
                org_id=org.id,
                user_id=user.id,
                role="owner",
            )
        )
        session.commit()


def demo_planning_skill() -> Skill:
    return Skill(
        id="skill_demo_planning",
        org_id=DEFAULT_ORG_ID,
        name="structured-planning",
        display_name="结构化任务规划",
        description="把复杂目标拆解为阶段、依赖、风险和可执行检查项，适合项目规划、上线准备和复盘。",
        instructions=(
            "# 结构化任务规划\n\n"
            "使用这个 skill 时，先明确目标和约束，再输出阶段计划、依赖、风险、验收标准。\n\n"
            "## 输出要求\n"
            "- 使用简洁标题分段\n"
            "- 每个阶段给出可执行任务\n"
            "- 明确阻塞条件和验证方式\n"
        ),
        allowed_tools_json='["checklist"]',
        metadata_json='{"domain":"planning"}',
    )


def ensure_demo_skill(session: Session) -> None:
    existing = session.get(Skill, "skill_demo_planning")
    if existing:
        ensure_skill_version(session, existing)
        return
    skill = demo_planning_skill()
    session.add(skill)
    session.commit()
    ensure_skill_version(session, skill)


def ensure_skill_version(session: Session, skill: Skill) -> None:
    existing = session.exec(
        select(SkillVersion)
        .where(SkillVersion.skill_id == skill.id, SkillVersion.version == skill.version)
        .limit(1)
    ).first()
    if existing:
        return
    session.add(
        SkillVersion(
            id=f"skillver_{skill.id}_{skill.version}",
            org_id=skill.org_id,
            skill_id=skill.id,
            version=skill.version,
            name=skill.name,
            display_name=skill.display_name,
            description=skill.description,
            instructions=skill.instructions,
            allowed_tools_json=skill.allowed_tools_json,
            metadata_json=skill.metadata_json,
            status=skill.status,
            created_at=skill.updated_at or skill.created_at,
        )
    )
    session.commit()


def ensure_published_agent_snapshots(session: Session) -> None:
    from app.services.runtime_snapshot_service import create_release_snapshot

    agents = session.exec(select(Agent).where(Agent.status == "published")).all()
    changed = False
    for agent in agents:
        existing = session.exec(
            select(AgentReleaseSnapshot)
            .where(AgentReleaseSnapshot.agent_id == agent.id, AgentReleaseSnapshot.version == agent.version)
            .limit(1)
        ).first()
        if existing:
            continue
        create_release_snapshot(agent, session, agent.version, agent.published_at or agent.updated_at)
        changed = True
    if changed:
        session.commit()


def builtin_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(
            id="current_time",
            org_id=DEFAULT_ORG_ID,
            name="当前时间",
            description="返回当前 UTC 时间，适合时间戳、日志和计划类任务。",
            category="utility",
            implementation="builtin",
        ),
        ToolDefinition(
            id="word_count",
            org_id=DEFAULT_ORG_ID,
            name="文本统计",
            description="统计文本字符数和词数，适合文案、摘要和内容检查。",
            category="text",
            implementation="builtin",
        ),
        ToolDefinition(
            id="checklist",
            org_id=DEFAULT_ORG_ID,
            name="清单生成",
            description="把任务项整理成 Markdown checklist。",
            category="planning",
            implementation="builtin",
        ),
    ]


def ensure_builtin_tools(session: Session) -> None:
    changed = False
    for definition in builtin_tool_definitions():
        existing = session.get(ToolDefinition, definition.id)
        if existing:
            continue
        session.add(definition)
        changed = True
    if changed:
        session.commit()

def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
