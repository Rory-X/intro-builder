# Agent Workflow Runtime v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Agent v2 toward long-loop resume sessions with 200k context status, clean Agent Mode UI, durable session-ready workspace events, and local debugging support.

**Architecture:** Keep Web as the browser boundary and final resume write owner. Add v2 context/workspace state as typed AG-UI state/activity events first, then layer durable session storage and workflow runtime behind the same contract. The first executable slice upgrades the current v1 route to emit v2-compatible context status while preserving the existing Agent panel flow.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, AG-UI `@ag-ui/core`/`@ag-ui/encoder`, assistant-ui AG-UI runtime, Vitest, TypeScript, existing Node Agent service.

---

## Scope

This plan implements v2 incrementally without pausing the current Agent Mode:

1. First slice: typed `ContextStatus`, AG-UI context status events, Web stream extraction, clean context indicator UI, and simplified tool/action labels.
2. Second slice: `ResumeWorkspace` / `ResumeChangeSet` state events and session-ready in-memory projection.
3. Third slice: Web-backed durable session/event log.
4. Fourth slice: real workflow runtime under `apps/agent/src/workflows/`.
5. Fifth slice: create-from-zero workflow and SDK executor boundary.

The current execution starts with slice 1 so the user can run the app locally and debug the visible v2 direction immediately.

## File Structure

- Create `packages/shared/src/types/agent-v2.ts`: shared v2 session, context, workspace and display types.
- Modify `packages/shared/src/types/index.ts`: export v2 types.
- Create `apps/agent/src/workflows/context-status.ts`: estimate/construct the v2 `ContextStatus` for a run.
- Modify `apps/agent/src/agent-messages.ts`: emit `STATE_DELTA` and `ACTIVITY_SNAPSHOT` context status events before assistant text.
- Modify `apps/web/lib/agent/ag-ui-stream.ts`: extract `ContextStatus` from AG-UI state/activity events.
- Modify `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`: observe context status events and pass them to panel state.
- Create `apps/web/components/agent/agent-context-indicator.tsx`: compact user-facing context indicator.
- Modify `apps/web/components/agent/agent-panel.tsx`: render context indicator and product-facing action labels instead of internal tool names in default UI.
- Add or update tests in `apps/agent/tests/agent-messages.test.ts`, `apps/web/tests/unit/agent-ag-ui-stream.test.ts`, and `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`.

## Task 1: Shared v2 Context Types

**Files:**
- Create: `packages/shared/src/types/agent-v2.ts`
- Modify: `packages/shared/src/types/index.ts`
- Test through downstream compile and unit tests.

- [x] **Step 1: Write failing imports in downstream tests**

Add tests that import `ContextStatus` and `AgentContextSourceStatus` from `@intro-builder/shared/types`.

- [x] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-stream.test.ts`

Expected: FAIL because the v2 types are not exported.

- [x] **Step 3: Add minimal shared types**

Add the `ContextStatus` and source/warning union types matching the v2 spec.

- [x] **Step 4: Re-run tests**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-stream.test.ts`

Expected: PASS for the new import-level behavior.

## Task 2: Agent Emits 200k Context Status Events

**Files:**
- Create: `apps/agent/src/workflows/context-status.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Test: `apps/agent/tests/agent-messages.test.ts`

- [x] **Step 1: Write failing test**

Add a test that calls `toAgUiAgentEvents()` and expects:

- a `STATE_DELTA` event updating `/contextStatus`,
- an `ACTIVITY_SNAPSHOT` with `activityType: "context_status"`,
- `effectiveInputBudgetTokens` equal to `200000`,
- the context status event to appear before text message content.

- [x] **Step 2: Verify red**

Run: `pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts`

Expected: FAIL because no context status events exist.

- [x] **Step 3: Implement context status builder and event emission**

Add a deterministic estimator based on current request message and section character counts. It should produce `healthy`, `near_limit`, `compacting`, or `blocked` status while guaranteeing the v2 budget metadata exists.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts`

Expected: PASS.

## Task 3: Web Extracts Context Status From AG-UI

**Files:**
- Modify: `apps/web/lib/agent/ag-ui-stream.ts`
- Test: `apps/web/tests/unit/agent-ag-ui-stream.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for `extractAgUiContextStatus()`:

- returns context status from `ACTIVITY_SNAPSHOT activityType=context_status`,
- returns context status from a `STATE_DELTA` patch to `/contextStatus`,
- ignores malformed payloads.

- [x] **Step 2: Verify red**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-stream.test.ts`

Expected: FAIL because extractor does not exist.

- [x] **Step 3: Implement extractor**

Validate only the fields needed by the UI and keep raw transport details out of the panel.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-stream.test.ts`

Expected: PASS.

## Task 4: Agent Panel Shows Clean Context Indicator

**Files:**
- Create: `apps/web/components/agent/agent-context-indicator.tsx`
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing UI tests**

Add a test that streams a context status activity and expects:

- `上下文充足` to be visible,
- `约 24%` to be visible,
- internal names like `effectiveInputBudgetTokens`, `workspace.update_facts`, and `resume_read` not to appear.

- [x] **Step 2: Verify red**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx`

Expected: FAIL because the panel has no context indicator.

- [x] **Step 3: Implement minimal indicator and observer**

Wire context status events through the runtime provider to panel state. Render a compact indicator in the header using user-facing Chinese copy.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx`

Expected: PASS.

## Task 5: Simplify Default Tool Display

**Files:**
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing test**

Update the running-tool test to expect “正在读取简历” or “正在整理事实” and explicitly assert that `resume_read` is not rendered.

- [x] **Step 2: Verify red**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx`

Expected: FAIL because current UI renders `正在执行工具 resume_read`.

- [x] **Step 3: Implement product-facing tool labels**

Map internal tool names to user-facing labels in the panel. Keep internal names only in JS state and tests.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx`

Expected: PASS.

## Task 6: Local Debug Loop

**Files:**
- Modify docs only if local run notes change.

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-stream.test.ts tests/unit/agent-panel-assistant-ui.test.tsx
```

- [x] **Step 2: Start local services**

Run:

```bash
pnpm dev:web
pnpm dev:agent
```

- [x] **Step 3: Provide local URLs**

Report:

- Web: `http://localhost:3000`
- Agent: `http://127.0.0.1:8787/health`

Do not claim the full v2 objective is complete until durable sessions, workflow runtime, and local iterative debugging have all been implemented and verified.

## Task 7: Emit Resume Workspace / Change Set State

**Files:**
- Modify: `packages/shared/src/types/agent-v2.ts`
- Create: `apps/agent/src/workflows/resume-workspace.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/web/lib/agent/ag-ui-stream.ts`
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Tests: `apps/agent/tests/agent-messages.test.ts`, `apps/web/tests/unit/agent-ag-ui-stream.test.ts`, `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing Agent event test**

Add a test that calls `toAgUiAgentEvents()` with a request and a proposed operation, then expects:

- a `STATE_DELTA` event updating `/workspace`,
- an `ACTIVITY_SNAPSHOT` with `activityType: "resume_workspace"`,
- one `changeSets[]` item whose operation ids match the proposed operations,
- the workspace event to appear after tool result events and before `RUN_FINISHED`.

- [x] **Step 2: Write failing Web stream tests**

Add tests for `extractAgUiResumeWorkspace()`:

- returns workspace from `ACTIVITY_SNAPSHOT activityType=resume_workspace`,
- returns workspace from a `STATE_DELTA` patch to `/workspace`,
- ignores malformed payloads.

- [x] **Step 3: Implement shared workspace/change-set types**

Add minimal v2 types for `AgentResumeWorkspaceSnapshot`, `AgentResumeChangeSet`, `AgentResumeFact`, `AgentUserDecision`, and `AgentResumeQualityReport`. Keep the types product-facing and session-ready, but do not persist them yet.

- [x] **Step 4: Implement Agent workspace event emission**

Build an in-memory workspace projection from the current request and parsed provider output:

- mode: `optimize_existing`,
- goal from current resume title/workflow,
- facts derived from current context sections,
- one staged change set when proposed operations exist,
- empty decisions and nullable quality report.

Emit it through AG-UI state/activity events without changing the existing Web-owned apply boundary.

- [x] **Step 5: Wire Web projection**

Observe workspace events in the runtime provider and store the latest workspace in panel state. Default UI may stay minimal; use the projection to show a small pending-change-set status only when staged change sets exist. Do not expose internal state keys, tool names, or JSON.

- [x] **Step 6: Verify slice**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-stream.test.ts tests/unit/agent-panel-assistant-ui.test.tsx
pnpm --recursive typecheck
```

## Task 8: Web-backed Durable Session / Event Log

**Files:**
- Modify: `packages/shared/src/types/agent-v2.ts`
- Modify: `apps/web/db/schema.ts`
- Create: `apps/web/db/migrations/0011_add_agent_sessions.sql`
- Create: `apps/web/lib/agent/session-store.ts`
- Modify: `apps/web/app/api/agent/runs/route.ts`
- Tests: `apps/web/tests/unit/agent-session-store.test.ts`, `apps/web/tests/unit/agent-runs-route.test.ts`

- [x] **Step 1: Write failing session-store tests**

Add tests for a pure session reducer that:

- creates an `AgentSessionSnapshot` for `optimize_existing` runs,
- applies `STATE_DELTA /contextStatus` and `/workspace` events into the snapshot,
- records `RUN_FINISHED` interrupt outcomes as `waiting_user`,
- records `RUN_ERROR` as `failed`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-session-store.test.ts
```

Expected: FAIL because no durable session store exists.

- [x] **Step 3: Add shared session snapshot types and DB schema**

Add minimal `AgentSessionSnapshot`, `AgentWorkflowCursor`, `AgentSessionStatus`, and `AgentSessionInterrupt` shared types. Add `agent_session` and `agent_session_event` Drizzle tables plus SQL migration. This is additive only; no existing rows need backfill.

- [x] **Step 4: Implement Web session store**

Implement `createInitialAgentSessionSnapshot()`, `reduceAgentSessionSnapshot()`, and `persistAgentRunStream()`. The stream persistence must tee AG-UI SSE events, append `agent_session_event` rows, and update the compact `agent_session.stateJson` snapshot. Do not persist provider token chunks outside normal AG-UI events, and do not expose stored event internals in the default UI.

- [x] **Step 5: Wire `/api/agent/runs` stream tee**

After the Agent stream is created, tee `result.data.body`: return one branch to the browser and pass the other to `persistAgentRunStream()`. Persistence failures should log server-side but must not break the user-visible SSE stream.

- [x] **Step 6: Verify slice**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-session-store.test.ts tests/unit/agent-runs-route.test.ts
pnpm --recursive typecheck
```

## Task 9: Runtime Event Adapter Boundary

**Files:**
- Create: `apps/agent/src/workflows/workflow-runtime.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Test: `apps/agent/tests/workflow-runtime.test.ts`, `apps/agent/tests/agent-messages.test.ts`

- [x] **Step 1: Write failing runtime event tests**

Add tests for `buildWorkflowRuntimeEvents()` that expect:

- `run_started`, `state_snapshot`, `context_status`, `assistant_text_delta`, `tool_started`, `tool_result`, `workspace_snapshot`, `message_end`, and `run_finished` runtime events in order for a normal optimize-existing run,
- `run_finished` to include approval interrupts when staged operations exist,
- no AG-UI `EventType` values to appear in the runtime event type names.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/workflow-runtime.test.ts
```

Expected: FAIL because `workflow-runtime.ts` does not exist yet.

- [x] **Step 3: Implement the minimal runtime event model**

Create a small typed runtime event model under `apps/agent/src/workflows/workflow-runtime.ts`.
This first slice is an adapter boundary: it may still consume the parsed provider result, but it must produce product/runtime events before AG-UI conversion. It must not call Web, mutate resume data, or introduce a new provider loop yet.

- [x] **Step 4: Convert runtime events to AG-UI events**

Update `toAgUiAgentEvents()` to call `buildWorkflowRuntimeEvents()` and convert those runtime events to the existing AG-UI stream shape. Keep the current browser-visible behavior and ordering compatible with Tasks 1-8.

- [x] **Step 5: Verify green**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/workflow-runtime.test.ts tests/agent-messages.test.ts
pnpm --recursive typecheck
```

## Task 10: Typed Question Interrupts

**Files:**
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/workflows/workflow-runtime.ts`
- Modify: `apps/web/lib/agent/ag-ui-run-adapter.ts`
- Tests: `apps/agent/tests/agent-messages.test.ts`, `apps/agent/tests/workflow-runtime.test.ts`, `apps/web/tests/unit/agent-ag-ui-run-adapter.test.ts`

- [x] **Step 1: Write failing question interrupt tests**

Add tests that expect:

- provider JSON may include `questions[]` with `id`, `message`, optional `field`, and optional `responseSchema`,
- `buildWorkflowRuntimeEvents()` emits `RUN_FINISHED` interrupt outcomes with `reason: "input_required"` for questions,
- Web interrupt resume with `{ answer: "..." }` becomes a product-facing feedback message instead of approval-only copy.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/workflow-runtime.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-run-adapter.test.ts
```

Expected: FAIL because question payloads are ignored and resume feedback is approval-only.

- [x] **Step 3: Parse provider questions**

Extend the provider response parser with an optional `questions` array. Keep it optional in the parsed result shape so existing responses remain compatible. Update the prompt schema to describe this field.

- [x] **Step 4: Emit question interrupts from runtime**

Map parsed questions to `RUN_FINISHED.outcome.type="interrupt"` entries with `reason: "input_required"`, a user-facing message, a simple answer schema, and metadata `{ kind: "question", field }`.

- [x] **Step 5: Preserve question answers on resume**

Update the Web AG-UI run adapter so interrupt responses containing `{ answer }` are injected back into the Agent request as a Chinese feedback message. Keep approval feedback behavior intact.

- [x] **Step 6: Verify green**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/workflow-runtime.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-run-adapter.test.ts
pnpm --recursive typecheck
```

## Task 11: Development Preview Provider For Local Debugging

**Files:**
- Create: `apps/agent/src/workflows/dev-preview-provider.ts`
- Create: `apps/agent/tests/dev-preview-provider.test.ts`
- Modify: `apps/agent/src/index.ts`

- [x] **Step 1: Write failing dev provider tests**

Add tests that expect:

- `createDevelopmentAgentMessageProvider({ nodeEnv: "development" })` returns a provider,
- `createDevelopmentAgentMessageProvider({ nodeEnv: "production" })` returns `undefined`,
- the first local preview run emits provider JSON with `questions[]`,
- a resumed run that contains “用户已补充 Agent 需要的信息” emits a tool call and staged resume operation.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```

## Task 21: Create-Zero Final Review Answer Ends Local Preview Loop

**Files:**
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/tests/dev-preview-provider.test.ts`

- [x] **Step 1: Write failing provider test**

Add a test where the user answers `question_draft_review` after the durable session snapshot already contains a create-zero draft with skills drafted. Expected behavior:

- no staged resume operations,
- no new typed questions,
- the response summarizes that the draft direction has been confirmed,
- the draft resume is preserved in the workspace payload,
- no internal mode or fake tool names are exposed in the provider JSON content path.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```

Observed: FAIL because final-review answers fell back to the initial create-zero questions.

- [x] **Step 3: Implement final-review response**

Handle `question_draft_review` before the earlier create-zero intake branches. Return a product-facing local preview completion message, preserve `request.sessionSnapshot?.workspace.draftResume`, and keep `toolCalls`, `proposedOperations`, and `questions` empty.

- [x] **Step 4: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```

Expected: FAIL because the dev preview provider does not exist.

- [x] **Step 3: Implement deterministic development provider**

Create a deterministic `AgentMessageProvider` that returns safe, fake-but-product-shaped provider JSON for local UI debugging only. It must not call any network, must not fabricate real resume facts beyond echoing current resume text, and must clearly stay behind `config.nodeEnv === "development"`.

- [x] **Step 4: Wire local fallback**

In `apps/agent/src/index.ts`, use `createOpenAICompatibleAgentMessageProvider(config) ?? createDevelopmentAgentMessageProvider(config)` for `agentMessageProvider`. This keeps real model configuration higher priority and prevents production fallback.

- [x] **Step 5: Verify green**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts tests/agent-messages.test.ts tests/workflow-runtime.test.ts
pnpm --recursive typecheck
```

## Task 12: Unify Streaming Runs Through Workflow Runtime

**Files:**
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/tests/http.test.ts`
- Test: `apps/agent/tests/http.test.ts`, `apps/agent/tests/agent-messages.test.ts`, `apps/agent/tests/workflow-runtime.test.ts`

- [x] **Step 1: Write failing streaming HTTP tests**

Add tests for `/v1/agent/messages` with a streaming `AgentMessageProvider` that emits provider JSON containing:

- `questions[]` requiring user input,
- a completed tool call and staged resume operation.

The streamed AG-UI response must include the same v2 runtime-derived events as the non-streaming path:

- `STATE_DELTA /contextStatus`,
- `STATE_DELTA /workspace`,
- `ACTIVITY_SNAPSHOT activityType=resume_workspace`,
- `RUN_FINISHED outcome.type="interrupt"` with `reason: "input_required"` for questions,
- `RUN_FINISHED` approval interrupts for staged operations.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/http.test.ts
```

Expected: FAIL because `streamAgentMessageEvents()` currently emits the old hand-built tail events and does not route parsed streaming output through `buildWorkflowRuntimeEvents()`.

- [x] **Step 3: Reuse the runtime adapter for the parsed streaming tail**

After streaming visible assistant text and parsing the complete provider JSON, emit the remaining v2 events via `workflowRuntimeEventsToAgUiEvents()` / runtime event filtering so the stream path matches the non-streaming path for context, workspace, tool results, typed questions, approvals and run finish.

Avoid duplicating text already streamed. The final stream should not emit a second full assistant message.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/http.test.ts tests/agent-messages.test.ts tests/workflow-runtime.test.ts
pnpm --filter @intro-builder/agent typecheck
```

## Task 13: Pass Durable Session Snapshot Into Agent Runtime

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `apps/web/lib/agent/session-store.ts`
- Modify: `apps/web/app/api/agent/runs/route.ts`
- Modify: `apps/web/tests/unit/agent-runs-route.test.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/workflows/workflow-runtime.ts`
- Tests: `apps/web/tests/unit/agent-runs-route.test.ts`, `apps/agent/tests/agent-messages.test.ts`, `apps/agent/tests/workflow-runtime.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that prove:

- Web BFF loads `agent_session.stateJson` for `agent_session_${resumeId}` and forwards it as `request.sessionSnapshot` to the Agent service.
- `validateAgentMessageRequest()` accepts a valid `sessionSnapshot` and rejects malformed snapshots.
- `buildWorkflowRuntimeEvents()` emits `STATE_SNAPSHOT` with the existing session `contextStatus` and `workspace` instead of resetting both to `null`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-runs-route.test.ts
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/workflow-runtime.test.ts
```

Expected: FAIL because the durable session snapshot is currently persisted after the run but not loaded into the next run.

- [x] **Step 3: Implement snapshot loading and forwarding**

Add a session-store loader that returns the compact snapshot only when it belongs to the current user/resume. Forward the snapshot in `AgentMessageRequest` without exposing it in the UI or logs.

- [x] **Step 4: Implement Agent request validation and runtime state snapshot**

Extend the Agent request schema with optional `sessionSnapshot`. The runtime state snapshot should start from the provided session snapshot while still emitting a fresh context status for the current run.

- [x] **Step 5: Verify green**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-runs-route.test.ts
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/workflow-runtime.test.ts
pnpm --recursive typecheck
```

## Task 14: Persist Workflow Cursor Progress Across Runs

**Files:**
- Modify: `apps/agent/src/workflows/workflow-runtime.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/tests/workflow-runtime.test.ts`
- Modify: `apps/agent/tests/agent-messages.test.ts`
- Modify: `apps/web/lib/agent/session-store.ts`
- Modify: `apps/web/tests/unit/agent-session-store.test.ts`

- [x] **Step 1: Write failing workflow cursor tests**

Add tests that prove:

- `buildWorkflowRuntimeEvents()` emits a `workflow_cursor` event for every request-backed run.
- The emitted cursor increments `sessionSnapshot.workflow.loopCount` across runs.
- Runs with `questions[]` move the cursor to `await_user_input`.
- Runs with staged operations move the cursor to `await_change_approval`.
- `workflowRuntimeEventsToAgUiEvents()` converts the cursor to a `STATE_DELTA` patch at `/workflow`.
- Web `reduceAgentSessionSnapshot()` applies `/workflow` deltas into the durable snapshot.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/workflow-runtime.test.ts tests/agent-messages.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-session-store.test.ts
```

Expected: FAIL because the runtime currently emits no workflow cursor state delta and the Web reducer ignores `/workflow`.

- [x] **Step 3: Implement runtime cursor derivation**

Add a `workflow_cursor` runtime event after workspace state is built and before `message_end`.
The cursor should:

- start from `request.sessionSnapshot?.workflow` when available,
- otherwise start from `{ workflowId: request.workflowId, nodeId: "intake_goal", loopCount: 0, completedNodeIds: [] }`,
- increment `loopCount` by 1,
- append the previous `nodeId` to `completedNodeIds` once,
- set `nodeId` to `await_user_input` when `questions[]` exists,
- set `nodeId` to `await_change_approval` when staged operations exist,
- set `nodeId` to `final_review` when the run finishes without interrupts.

- [x] **Step 4: Convert and persist workflow cursor state**

Map `workflow_cursor` to an AG-UI `STATE_DELTA` with:

```json
[{ "op": "replace", "path": "/workflow", "value": "<AgentWorkflowCursor>" }]
```

Update `reduceAgentSessionSnapshot()` to apply valid `/workflow` patches without exposing workflow internals in the default UI.

- [x] **Step 5: Verify green**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/workflow-runtime.test.ts tests/agent-messages.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-session-store.test.ts
pnpm --recursive typecheck
```

## Task 15: Create-From-Zero Request Contract

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `apps/web/lib/agent/ag-ui-run-adapter.ts`
- Modify: `apps/web/tests/unit/agent-ag-ui-run-adapter.test.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/workflows/context-status.ts`
- Modify: `apps/agent/src/workflows/resume-workspace.ts`
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/tests/agent-messages.test.ts`
- Modify: `apps/agent/tests/dev-preview-provider.test.ts`
- Modify: `apps/agent/tests/http.test.ts`

- [x] **Step 1: Write failing create-from-zero contract tests**

Add tests that prove:

- Web AG-UI run adapter accepts forwarded props with `mode: "create_from_zero"`, `resumeId: null`, `workflowId: "create-from-zero"`, and `context: null`.
- `validateAgentMessageRequest()` accepts a create-from-zero Agent request with `resumeId: null`, `mode: "create_from_zero"`, `workflowId: "create-from-zero"`, and `context: null`.
- `buildAgentMessagePrompt()` describes the absence of a resume snapshot in product-facing Chinese instead of reading `context.sections`.
- The development preview provider asks for target role and basic profile facts on the first create-from-zero run.
- Agent HTTP accepts `resumeId: null` when the JWT has no resumeId claim and emits AG-UI events with a stable create-zero thread id.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-run-adapter.test.ts
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/dev-preview-provider.test.ts tests/http.test.ts
```

Expected: FAIL because `resumeId` and `context` are currently required and `create-from-zero` is not a supported workflow id.

- [x] **Step 3: Extend shared and Agent request types**

Update `AgentWorkflowId` to include `"create-from-zero"`. Allow `AgentMessageRequest.resumeId` to be `string | null`, add optional `mode?: "optimize_existing" | "create_from_zero"`, and allow `context` to be `AgentResumeContext | null`.

- [x] **Step 4: Implement create-from-zero validation and prompt fallbacks**

Validation rules:

- `mode="optimize_existing"` requires a non-empty `resumeId` and a valid `context`.
- `mode="create_from_zero"` requires `resumeId === null`, allows `context === null`, and defaults missing `workflowId` to `"create-from-zero"`.
- `sessionSnapshot.resumeId` and `workspace.resumeId` must match the nullable request resume id.

Prompt/context builders must not dereference `context` when it is null.

- [x] **Step 5: Wire adapters, dev provider, and HTTP thread/cache handling**

Map future Web forwarded props for create-from-zero into the new request shape. In Agent HTTP, allow JWTs without `resumeId` only for `request.resumeId === null`, use `agent_create_from_zero` as the default AG-UI thread id, and scope cache keys with a stable create-zero pseudo resume id.

- [x] **Step 6: Verify green**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-ag-ui-run-adapter.test.ts
pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/dev-preview-provider.test.ts tests/http.test.ts
pnpm --recursive typecheck
```

## Task 16: Create-From-Zero UI Entry And Intake Run

**Files:**
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`
- Modify: `apps/web/tests/unit/agent-runs-route.test.ts`

- [x] **Step 1: Write failing UI and route tests**

Add tests that prove:

- The empty Agent Mode welcome area shows one compact action labeled `从 0 创建简历`.
- Clicking it sends a user message but forwards `introBuilder` props with `mode: "create_from_zero"`, `resumeId: null`, `workflowId: "create-from-zero"`, and `context: null`.
- `/api/agent/runs` accepts the create-from-zero AG-UI run without querying `resumes`, signs an Agent token without `resumeId`, loads session id `agent_session_create_from_zero`, persists session mode `create_from_zero`, and uses thread id `agent_create_from_zero`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-runs-route.test.ts
```

Expected: FAIL because the welcome UI has no create-from-zero action and the runtime provider cannot derive create-zero forwarded props from `runConfig.custom`.

- [x] **Step 3: Add create-zero run config support**

Extend `AgentAgUiRuntimeProvider` so `runConfig.custom.mode === "create_from_zero"` causes `getIntroBuilderForwardedProps()` to receive a create-zero intent. Keep existing workflow prompts unchanged.

- [x] **Step 4: Add compact welcome action**

In `AgentWelcomeSuggestions`, render a small action button using `useThreadRuntime()`:

```tsx
threadRuntime.append({
  role: "user",
  content: [{ type: "text", text: "从 0 帮我做一份简历" }],
  runConfig: {
    custom: {
      mode: "create_from_zero",
      workflowId: "create-from-zero",
    },
  },
});
```

The button must stay visually consistent with the existing suggestion chips and must not show internal mode, workflow id, tools, or parameter names.

- [x] **Step 5: Wire AgentPanel forwarded props**

When the runtime provider asks for create-zero props, return:

```ts
{
  resumeId: null,
  mode: "create_from_zero",
  locale: "zh-CN",
  workflowId: "create-from-zero",
  context: null,
}
```

For all existing optimize-existing runs, continue returning the current resume snapshot context.

- [x] **Step 6: Verify green**

Run:

```bash
pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-runs-route.test.ts
pnpm --recursive typecheck
```

## Task 17: Create-From-Zero Draft Workspace

**Files:**
- Modify: `packages/shared/src/types/agent-v2.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/src/workflows/resume-workspace.ts`
- Modify: `apps/agent/tests/dev-preview-provider.test.ts`
- Modify: `apps/agent/tests/workflow-runtime.test.ts`
- Modify: `apps/web/lib/agent/ag-ui-stream.ts`
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing create-zero draft tests**

Add tests that prove:

- development preview provider returns a `draftResume` after target-role and basic-profile answers,
- create-zero runtime workspace snapshots carry the draft resume, target role and user-answer facts without staged section edits,
- Web Agent panel renders a simple user-facing draft status and does not expose `draftResume`, `workspace`, or `create_from_zero`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts tests/workflow-runtime.test.ts
```

Expected: FAIL because create-zero answers still route to the local staged section-update placeholder and workspace `draftResume` is null.

- [x] **Step 3: Add typed draft resume shape**

Add `AgentDraftResumeSnapshot` / section types to the shared v2 types and the Agent provider response parser. Keep the shape summary-oriented and safe: title, target role, profile summary, draft/needs-fact sections, and missing facts.

- [x] **Step 4: Build draft workspace from create-zero answers**

Update the dev preview provider to parse multiple question answers and return a draft resume instead of a fake update operation. Update workspace projection to surface the draft, target role, and user-answer facts while keeping change sets empty.

- [x] **Step 5: Show draft status in clean Agent Mode UI**

Validate draft workspace events in Web and render a compact status pill: `已生成简历草稿` / `待确认后再写入`. Do not expose raw state keys or internal mode names.

- [x] **Step 6: Verify green and browser smoke**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts tests/workflow-runtime.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx --runInBand
pnpm --recursive typecheck
```

Browser smoke on `http://localhost:3000/resume/dev-resume-agent-preview/edit`:

- Open Agent Mode.
- Click `从 0 创建简历`.
- Answer the two intake questions.
- Verify the panel shows `已生成简历草稿` and `待确认后再写入`.
- Verify the visible page does not expose `draftResume`, `workspace`, or `create_from_zero`.

## Task 18: Create-Zero Draft Continues Into Fact Intake

**Files:**
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/tests/dev-preview-provider.test.ts`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing provider test**

Update the create-zero draft provider test to require follow-up typed questions after the draft is created:

- `question_recent_experience` for the primary experience facts,
- `question_project_example` for the strongest project,
- `question_education` for education background.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```

Expected: FAIL because the local preview draft currently returns `questions: []` and ends the loop.

- [x] **Step 3: Add follow-up fact intake questions**

Update the development preview provider so create-zero answers produce both a draft resume workspace and the next typed fact-intake questions. Do not write to the resume or create staged section edits.

- [x] **Step 4: Guard Web integration**

Extend the Agent panel test fixture so a draft workspace event can be followed by an `input_required` interrupt. Verify the UI shows both `已生成简历草稿` and an answerable question card without exposing internal state keys.

- [x] **Step 5: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx --runInBand
```

Browser smoke:

- Run create-zero intake in the local Agent panel.
- Submit target-role and basic-profile answers.
- Verify the panel shows the draft status and then asks for recent experience facts.

## Task 19: Create-Zero Fact Answers Merge Back Into Draft

**Files:**
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/tests/dev-preview-provider.test.ts`
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing provider test**

Add a test where create-zero fact answers (`question_recent_experience`, `question_project_example`, `question_education`) are submitted after a durable session snapshot already contains a draft resume. Expected behavior:

- no staged resume operations,
- facts are merged into matching draft sections,
- missing facts for those sections are cleared,
- the next interrupt asks for skills/highlights,
- the provider does not restart the initial target-role/basic-profile intake.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```

Expected: FAIL because fact answers currently fall back to the initial create-zero questions.

- [x] **Step 3: Implement draft merge**

Use `request.sessionSnapshot?.workspace.draftResume` as the previous draft. Merge only user-provided fact answers into their matching sections and keep unanswered sections marked `needs_user_fact`. Return the next typed question for skills/highlights. Do not mutate Web/RHF/Postgres and do not stage fake section edits.

- [x] **Step 4: Make legacy drafts safe**

Handle older local draft snapshots that may be missing `profileSummary` by returning a valid placeholder summary instead of producing provider JSON that fails Agent parsing.

- [x] **Step 5: Prevent internal error leakage**

Sanitize Agent error messages that contain internal state paths or schema field names before showing them in the Agent panel.

- [x] **Step 6: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx --runInBand
```

Browser smoke:

- Start a clean create-zero flow.
- Answer the initial target-role/basic-profile questions.
- Answer the recent-experience/project/education fact questions.
- Verify the panel shows `已把这些事实合并进简历草稿` and then asks for skill keywords.
- Verify the visible UI does not expose `draftResume`, `profileSummary`, or internal mode/state keys.

## Task 20: Create-Zero Skill Highlights Merge And Final Review

**Files:**
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/tests/dev-preview-provider.test.ts`

- [x] **Step 1: Write failing provider test**

Add a test where the user answers `question_skills_highlights` after the durable session snapshot already contains a create-zero draft with basics, experience, projects and education drafted. Expected behavior:

- no staged resume operations,
- skills/highlights are merged into a `skills` draft section,
- `missingFacts` no longer contains the core drafted sections or `技能亮点`,
- the next interrupt asks for final draft review/confirmation,
- the provider does not restart target-role/basic-profile intake and does not emit fake tool calls.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```

## Task 22: Browser Smoke Hardening For Durable Create-Zero Sessions

**Files:**
- Modify: `apps/agent/src/workflows/resume-workspace.ts`
- Modify: `apps/agent/src/workflows/workflow-runtime.ts`
- Modify: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/tests/workflow-runtime.test.ts`
- Modify: `apps/agent/tests/http.test.ts`
- Modify: `apps/web/lib/agent/session-store.ts`
- Modify: `apps/web/tests/unit/agent-session-store.test.ts`

- [x] **Step 1: Reproduce in real browser**

Run Web + Agent locally, open `/resume/dev-resume-agent-preview/edit`, start `从 0 创建简历`, and submit the first intake answers.

Observed:

- Web console/server log reported `Failed to apply state patch` for `/workflow` because the AG-UI state snapshot did not initialize a `workflow` path before later `replace /workflow` deltas.
- Web session persistence reported `RangeError: Invalid time value` because Agent workspace snapshots used `requestId` as `updatedAt`.

- [x] **Step 2: Fix runtime state snapshot**

Include an initial workflow cursor in Agent runtime and streaming HTTP `STATE_SNAPSHOT` events so later `/workflow` state deltas apply cleanly in AG-UI.

- [x] **Step 3: Fix workspace timestamps**

Use ISO timestamps for workspace `updatedAt` and change-set `createdAt`. Add Web session-store defense so malformed workspace timestamps do not poison the session snapshot `updatedAt`.

- [x] **Step 4: Verify with browser**

Local browser smoke completed a 5-turn create-from-zero loop:

1. Start from zero.
2. Submit target role + basic profile.
3. Submit experience + project + education facts.
4. Submit skills/highlights.
5. Submit final draft review.

Verified:

- Panel shows `已生成简历草稿` / `待确认后再写入`.
- Context indicator is a 16px ring inside a 24px hit area; tooltip shows roughly `已用约 6k / 200k`.
- Copy/retry action buttons have layout space and do not overlap the following question card.
- Default visible UI does not expose `draftResume`, `profileSummary`, `workspace`, `create_from_zero`, `effectiveInputBudgetTokens`, or raw tool names.
- Agent session persisted to `final_review` with `loopCount = 5`.

- [x] **Step 5: Verify commands**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts tests/workflow-runtime.test.ts tests/agent-messages.test.ts tests/http.test.ts
pnpm --filter @intro-builder/web test -- tests/unit/agent-session-store.test.ts tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-runs-route.test.ts --runInBand
pnpm --recursive typecheck
pnpm test
pnpm lint
pnpm build
```

Result: all commands passed. `pnpm lint` still reports existing warnings only.

Observed: FAIL because skill-highlight answers fell back to the initial create-zero questions.

- [x] **Step 3: Implement skill-highlight draft merge**

Use `request.sessionSnapshot?.workspace.draftResume` as the previous draft. Merge the answer into a product-facing `skills` section, clear skill-related missing facts, return a `question_draft_review` typed question, and keep `toolCalls` / `proposedOperations` empty.

- [x] **Step 4: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent test -- tests/dev-preview-provider.test.ts
```
