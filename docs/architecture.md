# Agent Studio 架构决策

## 目标

Agent Studio 的目标不是一个“套壳聊天 UI”，而是一个可长期演进的 Agent 生产系统：

- 支持服务配置、发布、运行、观测和治理
- 支持复杂任务的计划、文件上下文、工具调用和子代理
- 支持模型通道，但不让模型适配层反过来主导 Agent 架构
- Web 端优先，移动端和 SSO 不进入当前重写范围

## 核心选型

### 执行核心：DeepAgents

DeepAgents 作为主执行层，原因：

- 它是 LangChain/LangGraph 上的 agent harness，而不是单次模型调用封装
- 内置 task planning、文件系统、子代理、memory、permissions 等能力
- 底层 LangGraph 支持 durable execution、streaming、human-in-the-loop
- 对“完善 Agent Studio 平台”的长期目标更贴合

### 模型通道：LangChain ChatModel

模型通道采用 LangChain 的 `init_chat_model` 和 Provider SDK：

- OpenAI：`langchain-openai`
- Anthropic：`langchain-anthropic`
- Google Gemini：`langchain-google-genai`
- OpenAI-compatible：使用 `ChatOpenAI(base_url=...)`

### LiteLLM 的位置

LiteLLM 不作为主依赖，也不作为主执行路径。

保留这个判断的原因：

- LiteLLM 的强项是多模型接口统一调用与代理网关，不是 Agent runtime
- DeepAgents 已经要求 tool-calling、streaming、subagent 这些运行时语义
- 如果过早引入 LiteLLM，平台核心会被“模型调用适配”牵着走

后续只有在需要大规模接入非 LangChain 官方支持的小众模型接口时，再把 LiteLLM 作为独立 Provider Adapter 引入。

## 后端边界

- `api/`：HTTP 协议层，只做参数校验和响应封装
- `core/`：领域模型与 API schema
- `services/agent_runtime.py`：DeepAgents runtime 构建与模型适配
- `services/agent_execution_service.py`：发布版本选择、运行上下文、执行记录和普通执行/预览隔离
- `services/openai_compatible_service.py`：`/v1/responses` 主入口和 `/v1/chat/completions` 兼容入口的协议适配
- `services/security.py`：密码哈希、访问令牌生成与哈希
- `services/audit_service.py`：审计日志落库与敏感 metadata 裁剪
- `infrastructure/audit_middleware.py`：请求级写操作审计
- `db/`：数据库连接和表初始化

## 当前版本范围

已纳入：

- DeepAgents-first 标准协议执行
- 模型通道 CRUD
- 模型通道连通性检测
- 服务配置 CRUD
- 服务未上线/线上/停用生命周期
- 服务发布生成 append-only release snapshot；运行只消费线上版本，保存配置不会自动发布
- Release readiness score
- 验收套件：服务级测试用例、单条运行、批量运行和发布检查
- Ability Registry：CRUD、工具权限、版本清单、历史恢复和导入/导出
- Service-level knowledge documents
- Subagent and tool configuration
- Tool Registry：内置工具、HTTP Connector、MCP 工具、OpenAPI 导入、MCP server 发现/批量导入、密钥引用、egress 策略、启停、运行验证、审计和 DeepAgents runtime 加载
- 固定回复规则
- 文本附件注入
- 会话历史
- Run Center：状态筛选、搜索、运行详情、完整输入输出和事件轨迹
- Auth / RBAC：本地账号、组织、成员角色、Bearer API Token 和默认管理员引导
- Audit：登录、Token 操作和业务写请求审计，Web 审计中心可查询
- DeepAgents harness policy：服务级排除内置工具、覆盖工具描述、禁用默认 general-purpose 子代理
- Runtime state：LangGraph checkpoint/store 由单一配置开关选择，单人本地默认 SQLite，共享/生产使用 Postgres
- 基础监控与统计、Ops 运行记录保留策略和运行态存储只读审计
- Database migrations：Alembic 基线迁移、SQLite 本地兼容和 PostgreSQL driver/runtime URL 支持

暂不纳入：

- 移动端 H5
- SSO / ticket / appToken
- 能力包上传
- 沙箱执行器
- 人工介入审批

## 下一阶段

1. 工具体系：补齐 MCP server 连接健康检查/批量同步、KMS / Vault 级密钥托管和更细的 egress 策略
2. 沙箱：引入安全执行 backend，承接文件系统和命令执行能力
3. 知识库：从当前上下文注入升级为 chunk、索引和召回评分
4. 可观测性：把当前 run events 扩展为 step、tool_call、subagent stream
5. Runtime state：补齐 checkpoint/store 清理、压缩、租户级配额和后台维护任务
6. 权限：把当前组织角色扩展到服务、工具、能力、知识库和发布流程的资源级策略

## Runtime State

DeepAgents 运行态由 LangGraph 承载：

- `AGENT_FORGE_RUNTIME_STATE_BACKEND=sqlite` 使用 `AsyncSqliteSaver` / `AsyncSqliteStore`，文件位于 `data/runtime/langgraph`
- `AGENT_FORGE_RUNTIME_STATE_BACKEND=postgres` 使用 LangGraph Postgres saver/store；未配置 `AGENT_FORGE_RUNTIME_STATE_POSTGRES_URL` 时复用应用库连接
- `thread_id` 使用 `<agent_id>:<conversation_id>`，同一个运行态库内隔离服务会话
- `AGENT_FORGE_RUNTIME_STATE_BACKEND=memory` 只作为本地临时调试 fallback，不作为共享环境默认路径

FastAPI lifespan 会创建本地运行态目录，并在进程退出时关闭 SQLite / Postgres 运行态连接，避免热重载和测试进程遗留悬挂连接。

## Runtime Backend

发布管理中的 backend 选择直接映射 DeepAgents backend：

- `filesystem`：使用 `FilesystemBackend(root_dir=..., virtual_mode=True)`，每个服务有独立虚拟根目录
- `state`：在不需要 Skill 文件源时可使用 `StateBackend`，适合轻量临时运行
- `store`：使用当前运行态 store，namespace 为 `(agent_id, "filesystem")`，让工作文件和 Skill source 进入 LangGraph store

平台数据库中的能力在运行前会渲染为 DeepAgents 标准 Skill 文件。当服务选择 `store` backend 时，平台会把绑定能力同步进同一个 LangGraph store namespace，确保 DeepAgents `SkillsMiddleware` 可以通过 backend API 读取能力文件，而不是依赖本地磁盘路径。

## DeepAgents Harness 治理

DeepAgents 的 `tools` 参数是追加式的，不能移除默认工具。平台不能只让用户配置“平台工具”，还必须能治理 harness 内置工具：

- `execute`
- `task`
- `write_todos`
- `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`

当前实现把这类策略保存到 `agents.harness_json`。运行时不调用全局 `register_harness_profile`，因为 DeepAgents profile registry 是按 provider/model 全局 additive merge 的，同模型服务会互相污染。平台改用 per-call middleware 注入 `_ToolExclusionMiddleware`，让每个服务的工具排除策略只作用于本次 `create_deep_agent` 构建。

禁用默认 `general-purpose` 子代理时，平台会显式排除 `task` 工具，并传入同名占位子代理阻止 DeepAgents 自动注入默认子代理。显式配置的业务子代理仍应通过发布管理维护。
