# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Agent Studio (repo dir `agent-forge`) — an enterprise platform for producing, running, and governing Agents on top of **DeepAgents** (a LangChain/LangGraph agent harness, not a single-call model wrapper). It manages model channels, service configs, ability packages, tools (builtin/HTTP/MCP), knowledge docs, acceptance test suites, run observability, and RBAC/audit.

Note: README/docs and most user-facing strings are in Chinese — match that when editing them. The app name shown to users is "Agent Studio"; the repo/dir is `agent-forge` and env vars are prefixed `AGENT_FORGE_`.

## Commands

Backend (Python 3.12+, run from `backend/`, uses `uv`):

```bash
cd backend
uv sync --python 3.12                                              # install deps
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8020    # run API
uv run alembic upgrade head                                        # apply migrations manually
uv run alembic revision -m "describe change"                       # new migration (then edit it)
```

Frontend (React 18 + Vite + TS, run from `frontend/`):

```bash
cd frontend
npm install
VITE_API_TARGET=http://localhost:8020 npm run dev -- --port 5183   # dev server (proxies /api and /v1)
npm run build                                                      # tsc -b && vite build — use this to typecheck
```

Full stack via Docker: `docker compose up --build` (backend :8020, frontend :5183).

Default URLs: Web `http://localhost:5183`, API docs `http://localhost:8020/docs`. Default local login: `admin@ysten.com` / `Yst@admin`.

There is **no test runner or linter configured** (no pytest suite, no eslint). `npm run build` (which runs `tsc -b`) is the only automated check; use it to verify frontend type correctness. To validate backend wiring, run the server and hit endpoints — the app seeds demo data on first boot.

## Migrations & DB

- `app.main` lifespan calls `initialize_database()` → runs Alembic `upgrade head` automatically on startup, then seeds demo data (`seed_demo_data` in `backend/app/db/session.py`). You usually do **not** need to run `alembic upgrade` by hand in dev.
- After changing a SQLModel table in `app/core/models.py`, add a matching Alembic migration in `backend/migrations/versions/`. Migrations are hand-written and chained; SQLite (dev) and PostgreSQL (prod) must both work.
- Default DB is `sqlite:///../data/agent-forge.db`. Override with `AGENT_FORGE_DATABASE_URL` (e.g. `postgresql+psycopg://...`).
- Seeding is idempotent: an empty DB gets a full demo (model channel, agent, skill, knowledge, test cases); a non-empty DB only ensures bootstrap identity + builtin tools exist.

## Architecture

### Backend layering (`backend/app/`)
Strict separation — keep HTTP concerns out of services and domain logic out of the API layer:
- `api/` — HTTP only: param validation + response shaping. Routers are wired in `api/router.py`. Most routers are mounted behind `Depends(require_write_access)` at the `/api` prefix; `api/openai_compatible.py` mounts separately at `/v1`.
- `core/models.py` — SQLModel tables (the persistence layer). `core/schemas.py` — API request/response models.
- `services/` — all domain logic (~50 modules). This is where real work lives.
- `db/` — engine, session, startup init/seed (`session.py`), migration runner (`migrations.py`).
- `infrastructure/audit_middleware.py` — request-level write auditing.
- `config.py` — single `settings` singleton (pydantic-settings, env prefix `AGENT_FORGE_`).

### The execution core (most important to understand)
A run flows through several services — read these together before touching runtime behavior:
- `services/agent_runtime.py` — **builds the DeepAgents agent**: maps a platform model channel → LangChain `ChatModel` (via `init_chat_model`), selects the DeepAgents backend (`filesystem`/`state`/`store`), wires checkpointer/store, skills, permissions, subagents, and harness tool-exclusion. This is the bridge between platform config and the SDK.
- `services/agent_execution_service.py` — selects the **published release snapshot**, builds run context, records the run, and isolates normal execution from preview.
- `services/execution_gateway.py` — thin orchestration wrapper (`execute_once`) over the execution service.
- `services/openai_compatible_service.py` — protocol adapter; `/v1/responses` is the primary entrypoint, `/v1/chat/completions` is a compatibility shim.
- `services/run_trace_service.py` — extracts `AIMessage.tool_calls`, `ToolMessage`, and `task` subagent calls from LangChain messages into the local run trace shown in Run Center.

### Key runtime concepts (don't break these invariants)
- **Releases are append-only.** Saving a service config does NOT publish it. Runs consume only the published release snapshot. Publishing creates a new `AgentReleaseSnapshot`.
- **Harness tool governance is per-call, never global.** DeepAgents' `tools` param is additive and its `register_harness_profile` registry merges globally per provider/model — which would cross-contaminate different services on the same model. The platform instead injects a per-call `_ToolExclusionMiddleware` so each service's excluded builtin tools (`execute`, `task`, `write_todos`, fs tools) and `tool_description_overrides` apply only to that one `create_deep_agent` build. Disabling the default `general-purpose` subagent additionally excludes `task` and passes a placeholder subagent to block auto-injection.
- **Skills are DB-first, rendered to files at run time.** Abilities live in the `skills`/`skill_versions` tables; before a run they're rendered into DeepAgents-spec Skill files under `data/runtime/agents/<agent_id>/skills/...`. For `store` backend they're synced into the LangGraph store namespace `(agent_id, "filesystem")` instead of disk.
- **LangGraph runtime state.** Default backend is SQLite (`AGENT_FORGE_RUNTIME_STATE_BACKEND=sqlite`): checkpointer + store files under `data/runtime/langgraph/`, `thread_id = "<agent_id>:<conversation_id>"`. `memory` backend is local-debug only. The FastAPI lifespan creates the dirs and closes SQLite connections on shutdown.
- **Ability tool permissions narrow the runtime toolset** by intersecting with the service/subagent tool config — they don't just write Skill files.

### Tools & secrets
- Tool definitions persist in `tool_definitions` (`services/tool_registry.py`, the largest service module). Three kinds: `builtin` (backend Python registry), `http` (GET/POST only, http(s) only, egress allow/deny with default private-network block — see `services/egress_policy.py`), and `mcp` (via `langchain-mcp-adapters`; stdio/http/sse/websocket transports). OpenAPI 3 JSON import generates HTTP tools (`services/openapi_importer.py`).
- **Secrets are never inlined.** LLM API keys and ToolSecrets are encrypted at rest with a key derived from `AGENT_FORGE_SECRET_KEY`; the API only reports whether a secret is configured. Inline `Authorization`/`X-API-Key`/`token`-style headers/fields are rejected (`services/metadata_security.py`) — tool auth must use `secret_headers`/`secret_env` references. Tool calls are audited to `tool_invocation_audits` without secret values.
- **`AGENT_FORGE_SECRET_KEY` must be stable in prod.** Changing it makes existing ciphertext undecryptable. The dev default is refused in production by `validate_secret_settings` (called in the lifespan). Check `/api/monitor/readiness` for blocking config risks.

### AuthZ / RBAC
Role ranks (`api/deps.py`): `viewer(10) < editor(20) < admin(30) < owner(40)`. `require_write_access` requires ≥ editor; viewers are read-only. Bearer API tokens are stored as hashes only. Everything is org-scoped (`org_id`, default `org_default`).

### Frontend (`frontend/src/`)
- `services/api.ts` — central API client. `services/authz.ts` — client-side role gating. `services/productLanguage.ts` — user-facing copy.
- `pages/*` — one file per top-level screen (Agents, Tools, Skills, Quality, RunCenter, Audit, Monitor, Providers, etc.); `pages/*Model.ts(x)` files hold the view-model/state logic for a page. `pages/admin/` — agent builder internals.
- `components/ui/` — shared presentational components (re-exported via `components/ui/index.ts`). `types/domain.ts` — shared domain types. State: TanStack Query for server state, Zustand for local. Vite dev server proxies `/api` and `/v1` to `VITE_API_TARGET`.

## Conventions
- Model channels go through LangChain `ChatModel` (`init_chat_model` + provider SDKs). Per `docs/architecture.md`, do **not** introduce LiteLLM as a primary execution path or let model-adapter concerns drive the agent architecture; DeepAgents is the execution core.
- Pass initialized `ChatModel` objects to DeepAgents, never bare model strings — subagents can bind their own channel/model.
- IDs are prefixed + uuid hex (`new_id("agent")` → `agent_<hex16>`); timestamps are ISO strings via `now_iso()` (see top of `core/models.py`).
