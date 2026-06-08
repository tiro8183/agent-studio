# Agent Forge Refactor Implementation Roadmap

> Source design: `docs/refactor-design-v2.md` v2.1.
>
> This roadmap is the execution contract for the DeepAgents-first refactor. It defines the full Slice 0-5 path before implementation starts, while only Slice 0 is expanded to detailed implementation steps. Later slices must preserve the invariants and public contracts established here.

## Goals

- Build Agent Forge around a single DeepAgents-first runtime chain: `RuntimeContract -> RuntimeManifest -> CompiledRuntimePlan -> DeepAgents -> RunEvent`.
- Keep Agent Studio as the main product workflow: draft, compile, inspect, preflight, publish, execute, and review evidence.
- Avoid carrying initialization-stage debt forward. Existing data, migration history, and legacy API compatibility are not constraints.
- Deliver each slice as a working vertical increment, not a partial rewrite.

## Non-Negotiable Invariants

- `RuntimeContract` is the only human-editable runtime input.
- `RuntimeManifest` is machine-generated, read-only, and never edited by users.
- `build_runtime_manifest(...)` is the only place where tools, skills, permissions, backend, subagent resources, and blockers are resolved.
- DeepAgents runtime code lives behind `runtime_adapter`; no other layer imports DeepAgents or LangChain runtime types.
- Execution consumes the frozen release manifest, never the draft contract.
- Release snapshots are append-only and freeze `{contract, manifest, manifest_hash}`.
- Secrets are never frozen into snapshots. Snapshots store only secret references.
- Live governance gates use stable ids from the snapshot, such as `tool_id`, `skill_id`, `provider_id`, `secret_ref`, and egress host keys. They only check current governance state and never re-resolve frozen config.
- `manifest_hash` is computed from canonicalized manifest data and is the cross-layer consistency anchor.
- `CompiledRuntimePlan` is transient and must expose `to_manifest_projection()` for guard/hash verification.
- The frontend never recomputes tool or permission semantics. Agent Studio Inspector always uses backend runtime-manifest APIs.
- No permanent test code is added to the project. Verification uses smoke scripts, typecheck/build commands, runtime guard behavior, and manual acceptance scenarios.
- No git branch, commit, or push is performed unless explicitly requested.

## Stable API Contracts

- `GET /api/agents/{agent_id}/runtime-manifest?source=draft|release`
  - Default `source=draft`.
  - Returns an envelope: `{ source, manifest, manifest_hash, release_id }`.
  - `source=release` returns the latest release snapshot manifest, or a clear not-found response if no release exists.

- `POST /api/agents/{agent_id}/runtime-manifest/preview`
  - Accepts the current unsaved `RuntimeContract` shape.
  - Does not persist any change.
  - Returns the same envelope shape with `source=preview`.

- `POST /api/agents/{agent_id}/preflight`
  - Uses the same manifest builder and runtime guard dry-run path.
  - Returns blockers, dry-run guard result, and `manifest_hash`.

- `POST /api/agents/{agent_id}/publish`
  - Builds the manifest through the same builder.
  - Freezes `{contract, manifest, manifest_hash}` into an immutable release snapshot.

- `/v1/responses`
  - Resolves the published Agent release.
  - Executes against the release manifest only.
  - Emits structured run events.

## Data And Schema Commitments

- Slice 0 may extend the current schema with minimal fields and tables, but must avoid destructive migration work until a separate high-risk confirmation is given.
- `agent_release_snapshots` must store `manifest_hash`; if the current table uses `spec_hash`, implementation may keep `spec_hash` as an existing compatibility field and add/use `manifest_hash` for the new chain.
- Introduce a `run_events` storage path for structured execution evidence. It may start as a table or as a strongly typed JSON array on `AgentRun`, but the API must expose events in a stable list shape.
- Snapshot data must include frozen provider call config, frozen tool implementation/schema, frozen skill source, resolved permissions, backend selection, subagent resolved plan, and stable ids for live governance checks.

## Slice Overview

### Slice 0: Manifest Artery

Build the smallest end-to-end runtime artery:

- Minimal Agent contract with model, system prompt, and one builtin tool.
- Runtime manifest envelope with canonical `manifest_hash`.
- Unsaved preview endpoint.
- Release snapshot freezing `{contract, manifest, manifest_hash}`.
- `CompiledRuntimePlan`, `to_manifest_projection()`, and execution guard.
- `/v1/responses` runs published manifest only.
- Structured RunEvent path visible in Run Center.
- Minimal Runtime Truth Strip in Agent Studio.

Exit criteria:

- Editing an unsaved contract changes preview `manifest_hash` without persisting.
- Publishing freezes a release manifest.
- Updating the draft after publish does not affect `/v1/responses`.
- Guard mismatch blocks execution and records a blocked run event.
- A successful run produces structured events that Run Center displays.

### Slice 1: Skills And Tool Narrowing

Add SkillPackage runtime semantics on top of Slice 0:

- Skill source is frozen into release snapshots.
- `allowed_tools` contributes to runtime tools through the manifest builder only.
- Main agent and subagents both receive Skill-derived tools through manifest resolution.
- Skill changes update draft/preview manifests but do not mutate published releases.

Exit criteria:

- Changing a Skill changes draft/preview manifest hash.
- Published runs keep using frozen Skill source.
- Runtime tools in UI, preflight, and execution stay aligned.

### Slice 2: Subagent Contracts

Add full subagent runtime contracts:

- Subagent-specific model/provider refs, system prompt, tools, skills, permissions, HITL, and output mode.
- Subagent resolved plan appears in manifest and `CompiledRuntimePlan`.
- Execution evidence includes subagent call events.

Exit criteria:

- Subagent model/tool/permission config is visible in manifest and compiled projection.
- Missing or disabled subagent dependencies block preflight and execution.
- Run Center can distinguish main agent, tool, and subagent events.

### Slice 3: HTTP/MCP Tools And Governance

Bring external tool governance into the manifest chain:

- HTTP and MCP tool implementation snapshots are frozen at publish.
- Runtime governance gates check live tool enabled state, secret availability, RBAC, and egress policy by stable ids.
- Tool invocation audits share run/event identifiers.

Exit criteria:

- Published tool config remains frozen after registry edits.
- Disabling a tool, removing a secret, or tightening egress blocks execution explicitly.
- Tool failures and governance blocks are visible in Run Center.

### Slice 4: Knowledge And Evaluation

Add knowledge and release validation:

- Knowledge snapshots or retrieval references enter the manifest/release boundary.
- Knowledge retrieval emits structured evidence events.
- Evaluation cases consume draft or release source explicitly.
- Publish readiness incorporates manifest blockers and evaluation state.

Exit criteria:

- Published runs use the release knowledge boundary.
- Knowledge retrieval evidence appears as structured events.
- Evaluation can prove a draft is ready without affecting the published release.

### Slice 5: Full Agent Studio Experience

Complete the product UI around the stabilized runtime artery:

- Full three-column Agent Studio.
- Eight-section structured editor with anchor navigation.
- Runtime Truth Strip across Studio, service list, and Run details.
- Manifest Diff for draft vs release and before vs after edits.
- Blocker-to-field navigation.
- Responsive layout: wide three columns, medium icon rail, narrow Inspector drawer.
- Full design token system: density, type, spacing, elevation, then color.

Exit criteria:

- Agent Studio is a polished production workflow, not a collection of CRUD pages.
- Users can see, understand, and fix runtime blockers without leaving the editor.
- Desktop and narrow viewports have no overlap or text overflow.

## Slice 0 Detailed Implementation Plan

### Task 0.1: Runtime Manifest Envelope And Hash

Files:

- Create: `backend/app/services/runtime_manifest_hash.py`
- Modify: `backend/app/core/schemas.py`
- Modify: `backend/app/services/runtime_manifest_service.py`
- Modify: `backend/app/api/agents.py`

Steps:

- Add a canonicalization helper that recursively normalizes dictionaries, lists, primitive values, and Pydantic/SQLModel objects into stable JSON-compatible data.
- Add `hash_runtime_manifest(manifest) -> str` using SHA-256 over canonical JSON with sorted keys and compact separators.
- Add `AgentRuntimeManifestEnvelopeRead` with fields `source`, `manifest`, `manifest_hash`, and optional `release_id`.
- Change the runtime-manifest GET route to accept `source=draft|release`.
- Return the envelope shape from the GET route.
- Keep existing callers working by updating frontend/API types in the same slice.

Verification:

- Run a backend smoke snippet that builds a manifest twice for the same Agent and confirms the hash is stable.
- Run a smoke snippet that changes a manifest field and confirms the hash changes.

### Task 0.2: Unsaved Runtime Manifest Preview

Files:

- Modify: `backend/app/core/schemas.py`
- Modify: `backend/app/api/agents.py`
- Modify: `backend/app/services/mappers.py` if current Agent create/update mapping cannot build an in-memory Agent safely.

Steps:

- Add a preview request schema that accepts the same editable runtime contract fields used by `AgentCreate`/`AgentUpdate`.
- Implement `POST /api/agents/{agent_id}/runtime-manifest/preview`.
- Load the persisted Agent only for org ownership, existing ids, and default values.
- Merge the request body into an in-memory Agent object.
- Build manifest and hash without adding, committing, or refreshing database records.
- Return envelope `{ source: "preview", manifest, manifest_hash, release_id: null }`.

Verification:

- Run a smoke snippet that calls the builder with a modified prompt/model/tools value and verifies the database Agent row is unchanged.

### Task 0.3: Release Snapshot Hash Freeze

Files:

- Modify: `backend/app/core/models.py`
- Modify: `backend/app/core/schemas.py`
- Modify: `backend/app/services/runtime_plan_service.py`
- Modify: `backend/app/services/agent_lifecycle_service.py`
- Modify: migration files only after separate high-risk confirmation if schema migration history must be rebuilt.

Steps:

- Add `manifest_hash` to release snapshot read schemas and internal runtime plan objects.
- When publishing, compute the manifest hash from the same manifest envelope path.
- Store `manifest_hash` on release snapshots.
- Preserve existing `spec_hash` only as a legacy/runtime-spec hash while new guard flow uses `manifest_hash`.
- Make release manifest envelope return `release_id` and the frozen `manifest_hash`.

Verification:

- Publish an Agent, then change the draft.
- Confirm latest release envelope still returns the original `manifest_hash`.

### Task 0.4: CompiledRuntimePlan And Guard

Files:

- Create: `backend/app/services/runtime_adapter/__init__.py`
- Create: `backend/app/services/runtime_adapter/compiled_plan.py`
- Create: `backend/app/services/runtime_adapter/guard.py`
- Modify: `backend/app/services/agent_runtime.py`
- Modify: `backend/app/services/agent_execution_service.py`

Steps:

- Define `CompiledRuntimePlan` with stable fields for model refs, tools, permissions, backend, harness policy, and subagent plans.
- Implement `to_manifest_projection()` so it returns only stable data comparable with `RuntimeManifest`.
- Implement `assert_manifest_alignment(manifest, manifest_hash, plan)` that hashes the projection and raises a domain error on mismatch.
- Wire execution to compile a plan before building the DeepAgents runnable.
- On guard failure, create/update an `AgentRun` with status `blocked`, emit `run_blocked`, and record audit metadata.
- Keep the actual DeepAgents call behind the adapter boundary; do not expose DeepAgents types to API/domain code.

Verification:

- Run a smoke snippet that compiles a plan from a manifest and verifies guard passes.
- Run a smoke snippet that mutates the projection before guard and verifies the run is blocked.

### Task 0.5: Structured Run Events

Files:

- Modify: `backend/app/core/models.py`
- Modify: `backend/app/core/schemas.py`
- Modify: `backend/app/services/agent_execution_service.py`
- Modify: `backend/app/api/runs.py`
- Modify: `frontend/src/types/domain.ts`
- Modify: `frontend/src/pages/RunCenterPage.tsx` or its model file.

Steps:

- Add a stable `RunEvent` shape: `id`, `run_id`, `type`, `scope`, `message`, `metadata`, `created_at`.
- Emit at least `run_started`, `model_invoked`, `tool_called`, `tool_result`, `run_completed`, and `run_blocked`.
- Store events in the chosen Slice 0 storage path.
- Expose run events through run detail/evidence APIs.
- Render a simple structured event list in Run Center.
- Stop adding new message-shape parsing logic for Slice 0 evidence.

Verification:

- Execute one successful minimal run and confirm Run Center shows structured events.
- Trigger one guard block and confirm Run Center shows `run_blocked`.

### Task 0.6: Frontend Minimal Inspector

Files:

- Modify: `frontend/src/types/domain.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/pages/admin/AgentBuilder.tsx`
- Modify: `frontend/src/pages/admin/AgentStudioChrome.tsx` or related Inspector panel file.

Steps:

- Add frontend types for `AgentRuntimeManifestEnvelope`.
- Add API methods for:
  - `getAgentRuntimeManifest(id, source)`
  - `previewAgentRuntimeManifest(id, contract)`
- Add debounced preview calls while editing the Agent form.
- Add Runtime Truth Strip minimum display: short `manifest_hash`, readiness/blocker counts, and source label.
- Ensure Inspector reads backend manifest data only and does not recompute tools or permissions locally.
- Keep visual changes minimal; full design system work belongs to Slice 5.

Verification:

- Edit an unsaved field and confirm preview hash changes.
- Save/publish and confirm draft/release hashes can differ.
- Build frontend with `npm run build`.

### Task 0.7: Slice 0 End-To-End Acceptance

Files:

- No extra permanent test files.

Steps:

- Use the local backend Python runtime, preferring `backend/.venv/bin/python`.
- Run smoke checks for:
  - stable manifest hash
  - preview without persistence
  - publish freezes manifest hash
  - execution uses release manifest
  - guard block path
  - structured RunEvent visibility
- Run TypeScript/build verification.
- Start the local app and verify Agent Studio + Run Center manually in browser if the dev servers are available.

Suggested commands:

```bash
cd "backend"
PYTHONDONTWRITEBYTECODE=1 ".venv/bin/python" -m compileall app
```

```bash
cd "frontend"
npm run build
```

Manual acceptance:

- Create or use a minimal Agent with one builtin tool.
- Open Agent Studio.
- Confirm Runtime Truth Strip shows a manifest hash.
- Edit without saving and confirm preview hash changes.
- Publish.
- Edit draft after publish.
- Execute through `/v1/responses`.
- Confirm the run uses the published release and Run Center shows structured events.

## Execution Guardrails

- Do not delete migrations, data files, or tracked source files without a separate explicit confirmation.
- Do not introduce broad rewrites outside Slice 0.
- Do not move UI to the final Slice 5 design system during Slice 0.
- Do not add permanent test files.
- Do not commit unless explicitly requested.

## Handoff

Start implementation with Task 0.1. After each task, run the narrow verification for that task before moving on. If a task reveals that the current schema blocks Slice 0 without destructive migration work, pause and request confirmation using the dangerous-operation format required by project instructions.
