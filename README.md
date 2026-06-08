# Agent Studio

一个面向企业团队的 Agent 生产与运行治理平台。核心目标是围绕 DeepAgents 构建可配置、可运行、可观测的 Agent Studio，支持模型通道、服务配置、能力包、标准协议执行、会话历史、业务资料、验收用例和运行分诊。

不包含移动端 H5、嵌入态聊天、Lingxi ticket、App SSO 等历史鉴权链路。

## 技术栈

- 后端：Python 3.12+、FastAPI、SQLModel、SQLite / PostgreSQL、Alembic
- Agent runtime：DeepAgents 0.6.x + LangChain/LangGraph
- 模型通道：LangChain Provider SDK（OpenAI、Anthropic、Google GenAI、OpenAI-compatible）
- 前端：React 18、TypeScript、Vite、Ant Design、TanStack Query、Zustand

## 目录

```text
agent-forge/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── services/
│   │   └── main.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   └── package.json
├── data/
└── docker-compose.yml
```

## 启动

后端：

```bash
cd "backend"
uv sync --python 3.12
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8020
```

数据库迁移：

```bash
cd "backend"
uv run alembic upgrade head
```

默认使用 `sqlite:///../data/agent-forge.db`。生产环境可通过 `AGENT_FORGE_DATABASE_URL` 切到 PostgreSQL，例如：

```bash
AGENT_FORGE_DATABASE_URL="postgresql+psycopg://agent_forge:password@postgres:5432/agent_forge"
```

DeepAgents / LangGraph 运行态本地默认落到 SQLite：

```bash
AGENT_FORGE_RUNTIME_STATE_BACKEND="sqlite"
AGENT_FORGE_RUNTIME_STATE_DIR="../data/runtime/langgraph"
# 共享/生产环境使用 Postgres 运行态后端；为空时复用 AGENT_FORGE_DATABASE_URL
AGENT_FORGE_RUNTIME_STATE_POSTGRES_URL="postgresql://agent_forge:password@postgres:5432/agent_forge"
AGENT_FORGE_RUN_RETENTION_DAYS=30
AGENT_FORGE_RUN_RETENTION_MINIMUM=200
AGENT_FORGE_UPLOAD_QUOTA_TOTAL_BYTES=536870912
```

`AGENT_FORGE_RUNTIME_STATE_BACKEND=sqlite` 仅作为单人本地开发默认值，`memory` 只用于本地临时调试；共享/生产环境应使用 `postgres` 后端，并安装 `langgraph-checkpoint-postgres`。运行记录清理由 Ops 页按租户预览和执行，默认保留最近 30 天且至少保留 200 条运行。上传配额同时约束会话附件和业务资料，默认每个组织 512 MB。

前端：

```bash
cd "frontend"
npm install
VITE_API_TARGET=http://localhost:8020 npm run dev -- --port 5183
```

默认地址：

- Web: http://localhost:5183
- API: http://localhost:8020/docs

Docker：

```bash
docker compose up --build
```

默认本地账号：

- 邮箱：`admin@ysten.com`
- 密码：`Yst@admin`

生产或共享环境必须通过环境变量覆盖：

```bash
AGENT_FORGE_ENV="production"
AGENT_FORGE_SECRET_KEY="replace-with-a-long-random-secret"
AGENT_FORGE_BOOTSTRAP_EMAIL="admin@your-company.com"
AGENT_FORGE_BOOTSTRAP_PASSWORD="replace-with-a-strong-password"
AGENT_FORGE_BOOTSTRAP_ORG_NAME="Your Company"
```

`AGENT_FORGE_SECRET_KEY` 用于加密 LLM API Key 和 ToolSecret。生产环境不能使用默认开发密钥；密钥变更会导致历史密文无法解密，正式环境应通过密钥管理系统稳定注入并纳入备份恢复流程。可通过 `/api/monitor/readiness` 检查当前实例是否存在阻断级配置风险。

## 功能边界

已实现：

- 模型通道 CRUD
- 模型通道连通性检测
- 服务配置 CRUD
- 服务未上线、线上、停用生命周期
- 服务上线检查
- 服务级模型参数覆盖
- 工具、能力、长期记忆与子代理配置
- 能力 CRUD、启停、工具权限、元数据、版本记录、历史恢复、导入/导出与服务/分工角色绑定
- 服务专属业务资料上传、预览和上下文注入
- 服务验收套件、单个验收用例运行、批量运行和上线检查
- 关键词固定回复
- 会话创建、历史读取、删除
- DeepAgents-first 服务执行
- DeepAgents `skills`、`memory`、`backend`、`permissions`、`interrupt_on`、`response_format`、持久化 `checkpointer` 集成
- DeepAgents harness 内置工具治理：可排除 `execute`、`task`、文件系统工具和 `write_todos`，并可覆盖内置工具描述
- 可禁用 DeepAgents 默认 `general-purpose` 子代理，避免未显式编排的子代理能力暴露给模型
- LangGraph checkpointer/store 默认持久化到 `data/runtime/langgraph` 下的 SQLite，并按会话设置 `thread_id`
- 服务级虚拟文件系统运行目录和 allow-list 权限规则
- 发布管理可配置 backend 类型、Debug、HITL 中断工具、结构化输出、子代理独立权限和子代理结构化输出
- 子代理独立模型通道和模型配置
- 能力工具权限会在运行时收窄主服务/分工角色实际可加载工具
- 工具注册表持久化到数据库，支持内置工具、HTTP Connector 和 MCP 工具的创建、元数据编辑、启停和运行验证
- HTTP / MCP 工具可绑定到主服务、分工角色和能力工具权限，并作为 DeepAgents 运行时工具加载
- HTTP 工具支持本地密钥引用注入、egress allow/deny 策略、默认私网阻断和调用审计
- MCP 工具支持 `stdio`、`http` / `streamable_http`、`sse`、`websocket` transport，可把单个 MCP server tool 映射为平台工具 ID，并支持 header/env 密钥引用和调用审计
- MCP server 可发现工具列表、查看参数 schema，并批量导入选中的 MCP tools
- OpenAPI 3 JSON 可导入 GET / POST operation，自动生成 HTTP 工具、参数映射和 egress host
- LangChain ChatModel 模型通道
- 文本附件上传并注入上下文
- Run Center 运行检索、状态筛选、详情与执行轨迹
- Run Center 记录 DeepAgents tool call、tool result 和子代理调用事件
- Run Center 完整输入/输出详情
- 本地账号登录、组织、成员角色和 RBAC
- Bearer API Token 管理，token 仅保存哈希
- 业务 API 默认鉴权，viewer 只读，editor/admin/owner 可执行写操作
- 企业级审计日志基础：登录、Token 操作和关键业务写请求会记录操作者、组织、资源、状态、IP、耗时和裁剪后的 metadata
- Web 审计中心
- 健康检查和统计面板
- 空库启动自动生成可演示的模型通道、服务、能力包、业务资料和验收用例

后置：

- MCP server 连接健康检查、批量同步和权限模板
- 能力评测数据集和版本审批流
- 多模态图片解析
- 复杂 LLM 调用日志
- KMS / Vault 级密钥托管
- 向量检索知识库
- LangGraph cache/context_schema 和自定义 middleware 管理
- CI/CD 和部署加固

## DeepAgents 运行时设计

- 能力作为一等资源保存到数据库，通过 `/api/skills` 做 CRUD。
- 能力版本清单保存到 `skill_versions` 表；创建能力会自动生成初始版本，后续可手动发布当前内容、恢复历史版本、生成导出包并导入到其他环境。
- 主服务和分工角色保存能力 ID。运行前后端会把 active 能力渲染成 DeepAgents 规范的 Skill 文件，写入 `data/runtime/agents/<agent_id>/skills/...`。
- DeepAgents backend 支持 `filesystem`、`state` 和 `store` 三种模式；绑定 Skill 时自动使用可读取 Skill 文件的 backend。
- `filesystem` 模式使用 `FilesystemBackend(root_dir=..., virtual_mode=True)`，虚拟根限定在单个服务的 runtime 目录。
- `store` 模式使用 DeepAgents `StoreBackend`，文件和能力 source 落到 LangGraph store 的 `<agent_id>/filesystem` namespace，适合需要跨进程保留工作文件和运行记忆的服务。
- filesystem permissions 默认只允许读取 `/workspace/**`、`/skills/**`，写入只允许 `/workspace/**`，并有 `/**` deny 兜底。
- 主服务 memory 走 DeepAgents `memory` 参数；SubAgent memory 进入子代理 system prompt，避免向 SDK 传入不存在的字段。
- HITL 使用 DeepAgents `interrupt_on`；开启服务 Checkpoint 后，LangGraph checkpointer 使用默认 SQLite 后端持久化，store 也使用 SQLite 后端承载跨运行长期状态。
- 结构化输出通过 DeepAgents `response_format` 接收 JSON Schema。Schema 必须是 object，否则运行时回退为文本输出。
- 子代理可以独立绑定平台内的模型通道和模型；运行时传入已初始化的 ChatModel，不向 DeepAgents 传裸模型字符串。
- 能力工具权限不只写入 DeepAgents Skill 文件，还会和主服务/分工角色配置的工具取交集，作为运行时实际加载工具列表。
- 服务 harness 配置写入 `harness_json`，运行时通过 per-call middleware 注入 DeepAgents，不使用全局 `register_harness_profile`，避免同模型不同服务之间配置串扰。
- `excluded_tools` 会从模型可见工具里移除 DeepAgents 内置工具和平台工具；`disable_general_purpose_subagent` 会额外排除 `task` 并阻止默认 `general-purpose` 子代理自动暴露。
- `tool_description_overrides` 会改写 DeepAgents 内置工具和平台工具描述，可用于收窄 `task`、`read_file`、`write_file` 等工具的模型侧使用语义。
- Run Center 从 LangChain messages 中提取 `AIMessage.tool_calls`、`ToolMessage` 和 `task` 工具调用，形成本地执行轨迹。
- 工具定义存储在 `tool_definitions` 表中。当前支持 `builtin`、`http` 和 `mcp` 三种实现：内置工具仍由后端 Python 注册表控制；HTTP 工具通过 metadata 配置 `url`、`method`、`headers`、`timeout_seconds`；MCP 工具通过 metadata 配置 `transport`、`tool_name`、`url` 或 `command`，运行时包装为 LangChain `StructuredTool`。
- HTTP 工具只允许 `GET` / `POST` 和 `http` / `https` URL，设置请求超时并截断过长输出；默认禁止访问私有/本机网络，可通过 `egress_policy` 显式允许 host 或内网。
- MCP 工具经 `langchain-mcp-adapters` 加载，支持 `stdio`、`http` / `streamable_http`、`sse`、`websocket` transport；平台用工具 ID 包装目标 MCP tool，避免服务编排层暴露 server 内部同名冲突。
- MCP 导入会先连接 server 发现工具和参数 schema，再把选中的 MCP tool 生成平台 `mcp` 工具；导入后的工具仍走同一套服务/分工角色/能力工具权限和调用审计。
- LLM API Key 和 ToolSecret 以 `AGENT_FORGE_SECRET_KEY` 派生密钥加密存储；API 只返回是否已配置，不返回明文。
- LLM `extra_headers` 和工具 metadata 会拒绝内联 `Authorization`、`X-API-Key`、`client_secret`、`token` 等敏感 header/字段，工具鉴权必须使用 `secret_headers` / `secret_env` 引用。
- 工具调用审计写入 `tool_invocation_audits` 表，记录工具、URL、状态、耗时、请求/响应摘要和错误，不记录密钥值。
- OpenAPI 导入会把 operation 生成 `param_mapping`，运行时将服务输入映射到 path、query、header 和 JSON body；当前只支持 OpenAPI 3 JSON 的 GET / POST。
