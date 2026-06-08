# Agent Forge DeepAgents-first 重构设计方案 (v2.1 修正版)

> 本版在 v1 基础上修正了三处地基问题:
> 1. **把 Manifest 从"展示用的派生视图"升级为"真实编译输入"**——让 preview/preflight/publish/execution 不漂移成为*结构上不可能*,而不是*靠测试去防*。
> 2. **钉死 Contract → Manifest 的单向派生方向**,消除"两个单一事实来源"的歧义。
> 3. **用运行时一致性自检(production guard,非测试代码)守住核心不变量**,在不违反"不留永久测试"约束的前提下证明地基没裂。
> 同时补上 v1 沉默的两个决策:运行态持久化后端、运行证据采集方式。
>
> **v2.1 增补(评审后收口,本版可进入实施计划):**
> - **明确 Manifest 冻结边界**:冻结模型引用/tool schema/skill source/权限/backend/subagent 解析结果;**只冻结 secret reference,不冻结 secret 值**(见原则 1)。
> - **引入 `CompiledRuntimePlan`**:guard 在"平台自有结构 ↔ 平台自有结构"之间比对,不内省 DeepAgents 内部结构(见原则 2/3)。
> - **区分"配置冻结"与"运行治理门"**:快照配置 immutable,但执行期仍受当前治理状态(工具禁用/secret 缺失/egress 收紧)显式阻断(见原则 3)。
> - **用 `manifest_hash`(规范化序列化)替代"字节级一致"**:全链路围绕 hash 校验(见原则 2 与验收)。
> - **三个 open decision 拍板定稿**(见 Decisions)。
>
> **v2.1 第二轮评审收口(实施契约级,共 4 点):**
> - **provider 冻结边界补全**:冻结 `provider_type/base_url/model/default_headers(非密钥)/调用参数`,`api_key` 仍只冻 secret reference(原则 1)。
> - **未保存编辑的实时 Manifest**:新增 `POST /runtime-manifest/preview`,传当前 Contract、不落库、回 manifest+hash(API、Frontend)。
> - **guard hash 精确化**:不 hash 整个 Plan,改 `CompiledRuntimePlan.to_manifest_projection()` 后再规范化 hash(原则 2、API)。
> - **治理门稳定引用**:快照在实现快照旁保留 `tool_id/skill_id/provider_id/secret_ref`,执行期只用 id 查 live 治理状态、不重解析配置(原则 1/3)。

## Summary
- 主路径仍是 **Agent Studio 核心工作台**:一个 Agent 从草稿 → 编排 → 运行合约 → 上线检查 → 发布快照 → 运行证据的闭环。
- 项目按初始化阶段处理:不保留现有数据、迁移历史或 API 兼容,不合理模块允许删除重写。
- 本轮只做设计,不实施代码。实施按**最薄垂直切片优先**推进(见"实施排序"),不一次性重写成半成品。
- 坚持 DeepAgents-first:`deepagents==0.6.3` 为执行核心,LangChain Provider SDK 做模型适配,v1 不引入 LiteLLM 主路径。

---

## 核心原则(本版新增,优先级最高)

### 原则 1:Contract 是输入,Manifest 是输出,方向单向不可逆
- **RuntimeContract = 用户编写的菜谱**。模型、提示词、skills、tools、subagents、filesystem、permissions、backend、HITL、structured output、harness policy。草稿态可编辑,是唯一**被人编辑**的运行配置源。
- **RuntimeManifest = 算完之后实际下锅的料**。把 `Contract + ToolRegistry 现状 + 权限规则` 经**一个纯函数**算出的、完全解析后的结果:实际加载的 tools、收窄后的权限、backend 选择、子代理各自的 tool 集、以及阻断项 `blockers`。
- **Manifest 永不作为可编辑源持久化**。它只被"算出来 / 缓存 / 冻结进快照"。任何让 Manifest 变成"能手改又存下来"的设计都被禁止——那会把我们正要消灭的漂移原地复活。

#### Manifest 冻结边界(v2.1 收口,必须精确)
发布时冻结进快照的 Manifest,**冻结的是"完全解析后的配置",不是"对外部活体的引用"**。否则发布快照仍会被 live registry / skill 修改影响,immutable 名存实亡。

**冻结(随发布固化,之后外部怎么改都不影响这次发布):**
- **模型调用快照**:`provider_type` / `base_url` / `model` / `default_headers`(**不含密钥**)/ 调用参数(temperature/max_tokens 等),全部按发布点固化。⚠️ 不能只冻"模型标识"——`base_url`、`default_headers` 等影响"怎么调模型"的 provider 配置都要冻,否则发布后改 provider endpoint 会让旧快照漂移。`api_key` 例外,只冻 secret reference。
- **tool schema + 实现快照**:工具的入参 schema、类型(builtin/http/mcp)、关键实现元数据(url/method/transport/param_mapping 等)在发布点的副本。
- **skill source**:Skill 内容在发布点的副本(渲染用的源),不是指向"当前 Skill 表"的指针。
- **解析后的权限**:filesystem permissions、收窄后的 allow-list。
- **backend 选择**:filesystem / state / store。
- **subagent 解析结果**:每个子代理的模型、工具集、权限、提示词,全部解析到值。
- **稳定引用 id(与实现快照并存)**:在冻结实现快照的同时,保留 `tool_id` / `skill_id` / `provider_id` / `secret_ref`(以及 egress host key)。执行期的运行治理门**只用这些 id 查 live 治理状态,绝不用它们重新解析配置**——这是"配置冻结 + 治理门 live"能共存而不互相污染的关键机制(见原则 3)。

**不冻结(运行时解析 / 运行时判定):**
- **secret 值绝不冻结**——快照里只放 **secret reference**(`secret_headers` / `secret_env` 的引用名)。密钥在执行期按引用现取现解密;轮换密钥不破坏旧快照,也不会把密文焊死进发布记录。
- **运行治理门**——工具是否被禁用、secret 是否仍存在、egress 策略是否收紧、provider 通道是否停用等"当前治理状态",不进冻结配置,执行期按上面的稳定 id 查 live 状态判定(见原则 3)。

```
RuntimeContract (人写, 可变)
        │  build_runtime_manifest()   ← 全系统唯一的解析计算
        ▼
RuntimeManifest (机器算, 只读)
        │  preview / preflight / publish / execution 全部消费这一份
        ▼
ReleaseSnapshot (发布时冻结 Contract+Manifest, immutable)
```

### 原则 2:Manifest 不是展示视图,是真实编译输入
这是和 v1 最大的区别。v1 把 Manifest 当成"给 UI 看的一致快照",于是仍需要担心"展示的"和"跑的"是否一致。本版改为:

- **存在且仅存在一个** `build_runtime_manifest(contract, registry_snapshot, release_context) -> RuntimeManifest`。
- DeepAgents adapter 的**唯一输入就是 Manifest**(执行期是快照里的冻结 Manifest)。adapter 内部**不再做任何工具交集 / 权限收窄 / backend 推导**——这些只在 builder 里发生一次。
- preview、preflight、publish 也都调这同一个 builder。
- 结论:"界面显示的工具集"和"真实跑的工具集"是**同一个对象**,不是两次计算的结果。漂移从"需要测试去防"变成"代码结构上不可能发生"。

#### CompiledRuntimePlan:guard 的对比中介(v2.1 收口)
原 v2 设想的 guard 是 "assert 交给 SDK 的 tool 列表 == Manifest"。问题:要做到就得内省 `create_deep_agent` 的内部结构——这恰恰是我们要消灭的"依赖 DeepAgents 私有结构"。本版改为引入平台自有的 `CompiledRuntimePlan`:

```
RuntimeManifest (平台自有, 已解析配置)
        │  adapter.compile_plan(manifest)   ← 编译成平台自己可检查的计划
        ▼
CompiledRuntimePlan (平台自有, 可检查): tools[]、tool 描述覆盖、排除集、
        │                              permissions、backend、subagent 计划、模型句柄引用
        │  guard: assert Plan ⇔ Manifest 完全对应(纯平台结构对比, 不碰 SDK)
        ▼
create_deep_agent(**plan.to_sdk_args())   ← 仅此一步把平台计划翻译成 SDK 调用
```

- guard 只在 **Manifest ⇔ CompiledRuntimePlan** 两个平台自有结构之间比对,**永不内省 SDK 内部**。
- 唯一对 DeepAgents 版本敏感的是 `compile_plan` 末端的 `plan.to_sdk_args()` 翻译层;SDK 升级时只动这一小段,**guard 逻辑稳定不变**。这与"runtime_adapter 是唯一 touch DeepAgents 的层"一致。

### 原则 3:运行时一致性自检(守住地基,且不算测试代码)
即便 builder 唯一,仍要防 adapter 实现 bug 和发布后注册表变化。在真实运行路径里加一道 **production guard**(它是业务代码,不是测试文件,满足"不留永久测试"约束):

1. **执行前一致性 guard**:adapter `compile_plan(manifest)` 得到 `CompiledRuntimePlan` 后,assert **Plan ⇔ Manifest** 完全对应(tools / 排除集 / 描述覆盖 / permissions / backend / subagent 计划)。这是纯平台结构对比,不碰 SDK。不一致 → 拒绝运行,写入 `AgentRun.status=blocked` + 审计,不静默放行。
2. **发布消费 = 配置冻结 + 运行治理门(两件事,别混)**:
   - **配置冻结(immutable)**:执行期用快照里冻结的 Manifest——skill source、tool schema/实现快照都按发布点固化,**不**因为当前 registry/skill 变了就重新解析。这保住 immutable release。
   - **运行治理门(live, 显式阻断)**:执行期按快照里保留的**稳定 id**(`tool_id`/`skill_id`/`provider_id`/`secret_ref`/egress host key)查**当前治理状态**做安全/可用性判定,命中即 `blocked` + 审计,**绝不静默降级**。门是 `(稳定 id) × (live 治理状态)` 的纯函数,**只查状态、不重解析配置**。门包括:工具被管理员**禁用**、引用的 **secret 缺失/已轮换失效**、**egress 策略收紧**导致目标 host 不再允许、provider 通道被停用、调用者 RBAC 被回收。
   - 区别要点:"快照里写的工具 schema / provider endpoint 变了" → 不理会(冻结);"这个 tool_id 现在被禁了 / 这个 secret_ref 解析不到了 / 这个 host 被墙了" → 拦截(治理门)。前者是漂移要消灭,后者是运营管控要保留。
3. **preflight**:本质就是"跑一遍 builder 看 `manifest.blockers` 是否为空 + 跑一遍执行前 guard 的 dry-run + 预演一遍运行治理门"。

> 这道自检是这份方案全部价值的保险丝:它把"我配的 = 我看到的 = 实际跑的"从产品承诺变成系统不变量。

---

## Backend Design

### 分层
`api -> application -> domain -> infrastructure -> runtime_adapter`,替换当前 `agent_runtime.py` / `tool_registry.py` / 大 API 文件的膨胀。关键约束:

- **runtime_adapter 是唯一 touch DeepAgents 的层**。所有 `create_deep_agent`、以及 `deepagents` 的私有符号(`_ToolExclusionMiddleware`、`deepagents._tools._apply_tool_description_overrides` 等)**只许出现在这一层**。这样 DeepAgents 0.6.x → 后续版本的破坏性升级,爆炸半径被关进一层,其余代码对 SDK 无感知。
- adapter 对上暴露 `compile_plan(manifest) -> CompiledRuntimePlan`、`build_runnable(plan) -> DeepAgentsRunnable` 和 `run(runnable, input, emit_event) -> RunResult`,对下吸收所有 SDK 细节。`compile_plan` 产出平台自有的可检查计划供 guard 比对,`build_runnable` 末端的 `plan.to_sdk_args()` 是唯一对 SDK 版本敏感的翻译点。
- domain 层不 import 任何 LangChain / DeepAgents 类型;application 层编排用例,不写 SDK 代码。

### 核心领域对象
`AgentService`、`AgentDraft`、`RuntimeContract`、`RuntimeManifest`、`AgentReleaseSnapshot`、`AgentRun`、`RunEvent`、`LlmProvider`、`ToolDefinition`、`SkillPackage`、`KnowledgeDocument`。

- `AgentDraft` 持有可编辑的 `RuntimeContract`。
- `AgentReleaseSnapshot` 冻结 `{contract, manifest, manifest_hash, created_at, created_by}`,immutable,append-only。冻结边界见原则 1(只冻 secret reference 不冻 secret 值)。
- `RuntimeManifest` 不建表、不独立持久化;只在 snapshot 内被冻结存储,其余场景实时计算或短时缓存。
- `CompiledRuntimePlan` 是 runtime_adapter 内的瞬态结构,不持久化;只为 guard 比对和 SDK 调用翻译而生。

### 治理不变量 = 主链路的 Definition-of-Done(不许排到 phase 2)
greenfield 重写最大的隐性风险是"主链路优先"把横切治理悄悄丢了。以下几条是当前代码里不显眼但正确的东西,**必须写进主链路完成标准,随主链路一起验收**:

- **per-call harness 治理**:工具排除 / 描述覆盖 / 禁用默认 `general-purpose` 子代理,必须走 per-call middleware,**禁止**用 DeepAgents 全局 `register_harness_profile`(它按 provider/model 全局 additive merge,会让同模型不同服务互相污染)。
- **egress 策略**:HTTP 工具默认阻断私网/本机,白/黑名单显式放行。
- **密钥不内联**:LLM key / ToolSecret 以 `AGENT_FORGE_SECRET_KEY` 派生密钥加密落库;API 只回"是否已配置";拒绝 `Authorization`/`X-API-Key`/`token` 等内联,鉴权只走 `secret_headers`/`secret_env` 引用。
- **append-only 发布**:保存草稿 ≠ 上线;`/v1/responses` 只消费已发布快照。

### DeepAgents adapter(消费快照,不是 live contract)
- 执行期编译输入是 **快照里冻结的 Manifest**,不是草稿 Contract——否则 append-only 保证就破了。
- adapter 拆分子模块,各管一摊,互不耦合:
  - `model_init`:平台 LlmProvider → LangChain `ChatModel`(`init_chat_model` + provider SDK),传**已初始化的 ChatModel 对象**,绝不传裸模型字符串;子代理可绑各自通道。
  - `skill_source`:把 SkillPackage 渲染成 DeepAgents Skill 文件 / store namespace。
  - `backend_select`:`filesystem` / `state` / `store` 三选一,绑 Skill 时自动选可读 Skill 源的 backend。
  - `state_store`:checkpointer / store 装配(见下"持久化决策")。
  - `tool_load`:**直接吃 Manifest.tools,不再做交集**。
  - `harness_policy`:per-call 工具排除 / 描述覆盖。
  - `compile_plan`:把 Manifest 编译成 `CompiledRuntimePlan`(平台自有可检查结构),供执行前 guard 比对;Plan 暴露 `to_manifest_projection()`(投影回可比子集供 hash 断言)与 `to_sdk_args()`(末端唯一翻译成 `create_deep_agent` 调用的点)。

### 持久化决策(v1 沉默,本版定调)
- **应用库**:共享/生产环境 **Postgres-first**(`postgresql+psycopg`);SQLite 仅限单人本地开发。greenfield 不背 Alembic 历史,从干净基线重建。
- **运行态(LangGraph checkpointer/store)**:共享环境 **Postgres 后端**(`langgraph-checkpoint-postgres`),解决多 worker / 多副本下 SQLite 单机写锁的并发隐患;本地开发可退回 SQLite;`memory` 仅临时调试。后端选择是 `runtime_adapter.state_store` 里的**单个配置开关**,不许把 SQLite 单机假设渗进上层代码。
  - ✅ 已拍板:共享环境引入 Postgres saver,本地允许 SQLite(见 Decisions)。

### 运行证据采集(v1 沉默,本版定调)
- **执行期主动 emit 结构化事件**,而不是事后从 LangChain messages 重建(后者依赖 message 形状,脆)。
- adapter 的 `run(...)` 接收一个 `emit_event` 回调,在 tool call / tool result / subagent 调用 / LLM usage / knowledge retrieval 各节点写 `RunEvent`,落 `AgentRun` + `RunEvent` 表。
- Run Center 直接读结构化事件,不做消息体解析。

### API(收敛为主链路)
- `GET/POST/PATCH /api/agents` · `/api/agents/{id}`
- `PUT /api/agents/{id}/draft` —— 编辑 Contract(显式保存)
- `GET /api/agents/{id}/runtime-manifest` —— **返回已存草稿/快照 builder 实算的 Manifest + `manifest_hash`**
- `POST /api/agents/{id}/runtime-manifest/preview` —— **未保存编辑的实时 Manifest**:请求体传当前 `RuntimeContract`,**不落库**,只返回 manifest + hash。这是 Inspector 在编辑过程中实时反映运行影响的机制,避免"GET 已存草稿导致滞后"或"逼前端本地复算"。前端编辑时 debounce 调它;显式保存走 `PUT draft`。
- `POST /api/agents/{id}/preflight` —— 返回 `manifest.blockers` + dry-run guard 结果 + `manifest_hash`
- `POST /api/agents/{id}/publish` —— 冻结 `{contract, manifest, manifest_hash}` 成 immutable 快照

#### manifest_hash:全链路一致性锚点(v2.1 收口)
**不要用"字节级一致"判等**——JSON key 顺序、序列化差异会误伤。改为:后端对 Manifest 做**规范化序列化**(key 排序、数值/空值归一)后算 `manifest_hash`,作为全链路一致性锚点:
- `runtime-manifest`(GET / preview POST)返回 manifest + hash;前端展示与本地状态都围绕 hash 判断"是否还是同一份"。
- preflight / publish / execution 全部围绕 hash 校验:publish 把 hash 一起冻结;execution 用快照里的 hash。
- **guard 不 hash 整个 `CompiledRuntimePlan`**——Plan 里含模型句柄/函数引用等不可稳定序列化的活体对象。改为 `CompiledRuntimePlan.to_manifest_projection()` 投影回与 Manifest 同构的可比子集,再做同一套规范化序列化算 hash,断言 `hash(plan.to_manifest_projection()) == snapshot.manifest_hash`。
- 附带收益:hash 天然可作为前端缓存 key 和审计锚点。
- `/api/runs/*` —— 运行检索 / 详情 / 结构化事件轨迹
- `/api/assets/*` —— providers / tools / skills / knowledge
- `/v1/responses` —— 只消费已发布 Agent 的快照

---

## Frontend Design

### 信息架构(方向已定)
- 主 UI 三栏 Agent Studio:左侧服务清单,中间**结构化编排器**,右侧 Runtime Inspector。
- 顶层导航压缩为:`Agent Studio` · `Run Center` · `Assets` · `Governance` · `Experience`,不再把每个 CRUD 页面摆成一级入口。
- **右侧 Inspector 常驻,数据源唯一来自后端 runtime-manifest 接口**——这是原则 2 在 UX 层的落地:编辑中用 `POST /runtime-manifest/preview`(传当前未保存 Contract,debounce)实时取 manifest,已存草稿/快照用 `GET /runtime-manifest`。用户看到的 readiness / runtime manifest / 阻断项 / release snapshot / 最近运行证据,和后端真实编译输入是同一份对象,前端**不在本地复算任何工具/权限逻辑**,只围绕 `manifest_hash` 判断"是否还是同一份"。
- 重写大型页面:`AgentBuilder` / `RunCenterPage` / `ToolManagement` 拆为 feature model + data hooks + view components + drawers/panels;`api.ts` / `domain.ts` 按领域拆分。

### 设计感修正:先定系统,再谈颜色(v2.1 收口)
评审发现 v1/v2 的视觉描述只是"选对了范式 + 列了一串颜色",有**设计常识但无设计观点**,且是"颜色优先"思维。落地前按以下顺序收口,**颜色排在最后**:

**1. 先定设计系统(高级感的 90% 在这里,不在配色):**
- **密度优先**:这是数据密集的专业治理工具,默认采用**紧凑密度**(参考 Linear / Retool,而非消费级大留白)。Antd 6 走 `ConfigProvider` 主题算法 + `componentSize="small"` 基线,**顺着 Antd token 体系定制,不与之对抗**。
- **字阶与字重**:定义明确的 type scale(如 12/13/14/16/20/24)与字重层级;信息层级**优先靠字号/字重/间距表达,而非靠颜色**。等宽字体用于 id / hash / schema / manifest 等机器值。
- **间距节奏**:统一 4px 基准的 spacing scale,定义区块、表单行、卡片的固定节奏。
- **层级**:优先用边框 + 极轻背景分层,克制阴影;明确 elevation 规则。
- 这套 token(density / type / spacing / radius / elevation)是**设计 token 的主体**,先于颜色定稿。

**2. 再定一个 signature move(让产品"有脸"):**
- 围绕本产品独有的母题 **"Runtime Truth Strip / 运行真相带"**:把 `manifest_hash` + readiness + 阻断数做成一条贯穿全产品(Studio 顶部、清单项、Run 详情)的、可视化的"真相带",让"配置 → 真相"的映射成为一眼可认的视觉标识。这是把后端"单一事实来源"翻译成视觉语言的标志性决定,避免沦为"又一个 dev tool 模板"。

**3. 颜色最后定,且要可辨义:**
- 中性灰底、深色文字;**主色与 runtime 语义色必须明显可辨**——避免 v2 里 teal 主色 + cobalt runtime 辅色"两个都偏蓝"挨在一起分不清(runtime 辅色承担"这是运行真相"的语义,必须一眼可识别)。
- 状态色 amber/red 仅用于 readiness / blocker / 治理门,语义专用不滥用。
- 明确是否支持暗色模式(建议至少 token 层预留)。

### 中栏导航模型与响应式(补齐 v2 缺口)
v2 把 8 个分区一字排开却没说"怎么在它们之间走 / 窄屏怎么收",这两点落地前必须定:
- **8 分区导航**:Profile · Model Contract · Instructions · Skills + Tools · Subagents · Runtime Policy · Evaluation · Knowledge。采用**左侧锚点导航 + 分段滚动**(非隐藏式 tab),保证编辑任一分区时 Inspector 的运行影响始终可见;分区标题处显示该区是否产生 blocker。
- **"画布"正名**:中栏是**结构化多段编辑器**,不是自由节点图。唯一带拓扑性的是"主 Agent ↔ 子代理 ↔ 工具归属",为其提供一个**只读拓扑视图**,不做拖拽式 graph 编辑(对 agent 配置是过度工程)。
- **响应式与"Inspector 常驻"的张力**:定义断点策略——宽屏三栏常驻;中屏左侧清单收成图标条;窄屏 Inspector 收为可呼出抽屉(默认折叠、按需呼出),而非强行三栏挤压。验收"窄屏无溢出"以此策略为准,不是许愿。

### 两个治理工具才有的杀手锏交互(v2 漏掉,必须做)
- **Manifest Diff(而非只展示当前 manifest)**:Inspector 不止 dump 当前 manifest,要能显示两种 diff——①草稿 manifest vs 已发布快照 manifest(我这版改动相对线上动了哪些工具/权限/backend);②改动前 vs 改动后(实时反馈)。基于 `manifest_hash` 判定是否变更,变更时高亮差异。这是治理工具区别于普通配置表单的核心价值。
- **Blocker → 字段联动**:Inspector 里每个 blocker 可点击,**直接跳转到中栏导致它的那个分区/输入框**并高亮。preflight/上线检查的核心交互是"看到问题 → 一键定位 → 修复",不是给一张要自己满世界找的清单。

### 技术栈
保留 Ant Design 6 / TanStack Query / lucide-react;服务态用 TanStack Query,本地态用 Zustand。

---

## 实施排序:最薄垂直切片优先
不要先铺 8 个画布分区。先用一条最细的端到端线,验证 adapter ↔ Manifest 契约和那道自检:

- **Slice 0(打通主动脉,最高优先)**:一个 Agent → 最小 Contract(模型 + 提示词 + 1 个 builtin 工具)→ `build_runtime_manifest` → `/runtime-manifest` → preflight → publish 快照 → `/v1/responses` 跑通 → Run Center 看到结构化事件。**含执行前一致性 guard。** 这条线把 Contract/Manifest/adapter/snapshot/自检全部串起来,是整个架构的"是否成立"判定。
- **Slice 1**:Skills + `allowed_tools` 收窄,验证"改 Skill → manifest/preflight/UI/真实运行同步变化"。
- **Slice 2**:子代理独立模型/工具/权限。
- **Slice 3**:HTTP / MCP 工具 + egress 治理 + 密钥引用。
- **Slice 4**:knowledge 注入与召回证据、Evaluation 套件。
- **Slice 5**:三栏 Studio 完整 8 分区 + 设计系统(密度/字阶/间距先于颜色)+ Runtime Truth Strip signature + Manifest Diff + Blocker→字段联动 + 响应式断点策略 + Run Center 完整轨迹。
  > 注意:Inspector 的 manifest 展示在 Slice 0 就要接通(它是一致性的 UX 落地);本 slice 是把它升级成 **diff + 联动 + signature**,以及把设计系统成体系地铺开。

每个 slice 自身端到端可用,不留半成品。

---

## Verification Scenarios
- 创建 Agent 草稿,绑模型/工具/Skill/子代理后,Runtime Inspector 显示的 `manifest_hash` 与后端 `/runtime-manifest` 返回的 **hash 一致**(围绕 hash 判等,非字节比对)。
- 改 Skill `allowed_tools` 后,主 Agent 与子代理的真实 runtime tools、preflight、UI 预览**同步变化**(hash 随之变化);执行前 `CompiledRuntimePlan ⇔ Manifest` guard 通过。
- **一致性自检场景**:人为制造 `CompiledRuntimePlan` 与 Manifest 不一致(或 hash 不匹配),运行**被 block 并写审计**,而非静默放行。
- **配置冻结 vs 治理门场景**:发布后改 Skill 内容 / tool schema,已发布运行**不受影响**(冻结);但把该工具**禁用** / 移除其 secret / 收紧 egress 后,已发布运行**被显式 block 并写审计**(治理门生效),不静默降级。
- 发布后生成 immutable 快照;改草稿不影响 `/v1/responses` 已发布运行。
- Run Center 展示一次执行的输入、输出、tool calls、subagent events、LLM usage、knowledge retrieval evidence(均来自执行期结构化事件)。
- 前端按断点策略响应(宽屏三栏 / 中屏清单收图标条 / 窄屏 Inspector 收抽屉),各断点无重叠 / 无文字溢出,固定格式 UI 尺寸稳定。
- **Manifest Diff 场景**:改动草稿后,Inspector 高亮显示相对已发布快照 / 改动前的 manifest 差异(工具/权限/backend),`manifest_hash` 变化被正确反映。
- **Blocker 联动场景**:点击 Inspector 中任一 blocker,中栏定位并高亮到导致它的分区/字段。
- **设计系统验收**:density/type/spacing token 成体系且先于颜色定稿;主色与 runtime 语义色一眼可辨;Runtime Truth Strip 在 Studio / 清单 / Run 详情一致呈现。
- 按 AGENTS 约束**不把永久测试代码加入项目**;实施期以 smoke、typecheck、build、人工验收 + **运行时自检(production guard)** 验证。一致性不变量由 guard 守,不依赖测试文件。

---

## Assumptions
- 不保留 mobile H5、SSO、ticket、appToken 等历史链路。
- 不保留当前 SQLite/demo 数据、Alembic 历史或旧接口兼容。
- 删文件、重建迁移、提交、推送等高风险操作,实施前单独明确确认。
- 未经用户主动要求,不做 git commit / branch / push。

## Decisions(已拍板,进入实施计划)
1. **应用库:Postgres-first**(`postgresql+psycopg`),SQLite 仅限单人本地开发。
2. **运行态:共享环境引入 Postgres saver**(`langgraph-checkpoint-postgres`),本地允许 SQLite,`memory` 仅临时调试。后端选择是 `runtime_adapter.state_store` 的单个配置开关。
3. **production guard 保留**:它是业务运行保护(运行前一致性 + 运行治理门),不是测试代码,符合"不把测试代码添加到项目中"约束。

## v2.1 评审收口清单(实施前需落实的四点)
- [x] **Manifest 冻结边界**:冻结 模型引用/tool schema/skill source/权限/backend/subagent 解析结果;只冻 secret reference 不冻 secret 值。(原则 1)
- [x] **CompiledRuntimePlan**:guard 在 Manifest ⇔ CompiledRuntimePlan 之间比对,不内省 SDK;`to_sdk_args()` 是唯一 SDK 版本敏感点。(原则 2/3、adapter)
- [x] **release 依赖治理策略**:配置冻结(immutable)与运行治理门(工具禁用/secret 缺失/egress 收紧 → 显式 block)分离。(原则 3)
- [x] **manifest_hash**:规范化序列化算 hash,全链路(UI/preflight/publish/execution/guard)围绕 hash 校验,替代"字节级一致"。(API)
- [x] **前端设计系统先于颜色**:density/type/spacing/elevation token 成体系定稿,再定颜色;颜色需主色与 runtime 语义色可辨。(Frontend)
- [x] **Runtime Truth Strip signature**:把 manifest_hash/readiness/blocker 做成贯穿全产品的可视化母题。(Frontend)
- [x] **中栏导航 + 响应式**:8 分区用锚点导航(非隐藏 tab);定义宽/中/窄断点塌缩策略;"画布"正名为结构化编辑器 + 只读拓扑视图。(Frontend)
- [x] **Manifest Diff + Blocker→字段联动**:Inspector 做差异视图与 blocker 一键定位,而非纯 manifest dump 与裸列表。(Frontend)
- [x] **provider 冻结边界补全**:provider_type/base_url/model/default_headers(非密钥)/调用参数全冻,api_key 仅冻 secret ref。(原则 1)
- [x] **runtime-manifest/preview 端点**:未保存编辑实时出 manifest+hash,不落库,前端不复算。(API/Frontend)
- [x] **guard hash 精确化**:`to_manifest_projection()` 后再 hash,不 hash 含活体引用的整个 Plan。(原则 2/API)
- [x] **治理门稳定引用**:快照保留 tool_id/skill_id/provider_id/secret_ref,执行期只用 id 查 live 状态。(原则 1/3)
