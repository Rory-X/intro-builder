# Agent Mode Streaming Phase 3B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 3 by making Agent Mode stream AG-UI-compatible assistant-ui conversations and by adding a mobile Agent Sheet while preserving Web-owned resume state and confirmed writeback.

**Architecture:** Agent service and Web BFF support AG-UI `text/event-stream` streaming for `POST /v1/agent/messages` and `POST /api/agent/messages`. Web `AgentRuntimeProvider` keeps assistant-ui `LocalRuntime`, but its adapter returns an async generator that yields progressive text updates from AG-UI `TEXT_MESSAGE_CONTENT` events and consumes AG-UI tool events for Web-owned confirmation cards. Mobile uses a Sheet-like Agent panel while desktop keeps the Phase 3A left-column replacement.

**Tech Stack:** Next.js 16 App Router Route Handlers, Web `ReadableStream`, AG-UI `@ag-ui/core` / `@ag-ui/encoder`, assistant-ui `LocalRuntime` async generator, React 19, React Hook Form, Vitest, Node HTTP Agent service, OpenAI-compatible provider.

---

## Non-Negotiable Boundaries

- Existing OCR, resume import, and AI parsing stay out of the Agent microservice migration.
- Browser still calls the Web BFF, not the Agent service directly.
- assistant-ui manages thread/composer rendering only; RHF, autosave, preview, template state, and operation application remain Web-owned.
- Stream chunks never mutate RHF.
- Resume operations still require explicit `应用`.
- Agent tools must be minimal resume edit operations, not prompt-specific writing helpers.

## File Structure

- Create: `lib/agent/ag-ui-stream.ts`
  - Shared browser/server-safe AG-UI SSE encoder/reader helpers and operation event extraction.
- Modify: `lib/agent/agent-message-contract.ts`
  - Replace broad proposal tools with minimal resume operation tools.
- Modify: `apps/agent/src/agent-messages.ts`
  - Add a deterministic `toAgUiAgentEvents()` helper that yields AG-UI lifecycle, text, and tool events from parsed provider output.
- Modify: `apps/agent/src/agent-tools.ts`
  - Replace tool names with `resume_read`, `resume_update_section`, `resume_delete_section`, `resume_reorder_sections`, `resume_insert_section`.
- Modify: `apps/agent/src/http.ts`
  - If `Accept` includes `text/event-stream`, return an AG-UI streaming response for `/v1/agent/messages`.
- Modify: `lib/agent/client.ts`
  - Add `streamAgentMessage()` for Web BFF route code.
- Modify: `app/api/agent/messages/route.ts`
  - If browser `Accept` includes `text/event-stream`, proxy Agent stream and return SSE.
- Modify: `components/agent/agent-runtime-provider.tsx`
  - Change `sendMessage` from `Promise<string>` to an async iterable of text updates plus callbacks.
- Modify: `components/agent/agent-panel.tsx`
  - Fetch `/api/agent/messages` with `Accept: text/event-stream`, collect streamed AG-UI tool metadata, and yield text updates to assistant-ui.
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx`
  - Add mobile Agent Sheet path while preserving desktop layout.
- Modify docs:
  - `docs/agent/service-contracts.md`
  - `docs/agent/frontend-integration.md`
  - `docs/agent/assistant-ui-research.md`
  - `docs/agent/implementation-roadmap.md`

## Tasks

### Task 1: Shared AG-UI Stream Contract

**Files:**
- Create: `lib/agent/ag-ui-stream.ts`
- Test: `tests/unit/agent-ag-ui-stream.test.ts`

- [x] **Step 1: Write failing tests**

Test behaviors:

- `EventEncoder` emits `text/event-stream` AG-UI events.
- Parser reads AG-UI SSE events split across arbitrary chunks.
- Parser validates events with `BaseEventSchema`.
- Parser throws a useful error when an event payload is malformed.

Run: `pnpm vitest run tests/unit/agent-ag-ui-stream.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement AG-UI stream helpers**

Implement:

- `createAgUiSseStream(events, accept?)`
- `readAgUiSseStream(response)`
- `extractAgUiResumeToolResult(event)`

- [x] **Step 3: Verify**

Run: `pnpm vitest run tests/unit/agent-ag-ui-stream.test.ts`

Expected: PASS.

### Task 2: Minimal Resume Operation Tools

**Files:**
- Modify: `apps/agent/src/agent-tools.ts`
- Modify: `lib/agent/agent-message-contract.ts`
- Test: `apps/agent/tests/agent-tools.test.ts`

- [x] **Step 1: Write failing tests**

Test behaviors:

- Allowed tool names are `resume_read`, `resume_update_section`, `resume_delete_section`, `resume_reorder_sections`, and `resume_insert_section`.
- `resume_update_section` allows only safe field paths.
- `resume_delete_section` allows only section/item targets that Web can remove safely.
- `resume_reorder_sections` requires a non-empty string array order and cannot remove `basics`.
- Deprecated proposal tool names are rejected.

Run: `pnpm --filter @intro-builder/agent test -- agent-tools.test.ts`

Expected: FAIL because the old proposal tools are still accepted.

- [x] **Step 2: Implement minimal operation tool validation**

Keep the Web confirmation model, but rename the envelope from prompt-specific patch thinking into minimal `ResumeOperation` proposals.

- [x] **Step 3: Verify**

Run: `pnpm --filter @intro-builder/agent test -- agent-tools.test.ts`

Expected: PASS.

### Task 3: Agent Service AG-UI Streaming Response

**Files:**
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/http.ts`
- Test: `apps/agent/tests/agent-messages.test.ts`
- Test: `apps/agent/tests/http.test.ts`

- [x] **Step 1: Write failing tests**

Test behaviors:

- Provider JSON output can be converted into AG-UI `RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, and `RUN_FINISHED` events.
- `POST /v1/agent/messages` returns `text/event-stream` when requested with `Accept: text/event-stream`.
- Streaming response still enforces JWT scope, resume id match, provider configuration, Redis rate limit, and provider parse validation.

Run: `pnpm --filter @intro-builder/agent test -- agent-messages.test.ts http.test.ts`

Expected: FAIL because AG-UI streaming route support does not exist.

- [x] **Step 2: Implement Agent streaming path**

Use the same validation/auth/rate-limit code as the JSON path. After provider response parsing succeeds, return a `ReadableStream` encoded with `EventEncoder`.

- [x] **Step 3: Verify**

Run: `pnpm --filter @intro-builder/agent test -- agent-messages.test.ts http.test.ts`

Expected: PASS.

### Task 4: Web BFF AG-UI Streaming Proxy

**Files:**
- Modify: `lib/agent/client.ts`
- Modify: `app/api/agent/messages/route.ts`
- Test: `tests/unit/agent-client.test.ts`
- Test: `tests/unit/agent-messages-route.test.ts`

- [x] **Step 1: Write failing tests**

Test behaviors:

- `createAgentClient().streamAgentMessage()` sends `Accept: text/event-stream`.
- Web route signs `agent:chat`, validates ownership, and proxies the Agent stream when browser requests AG-UI SSE.
- Non-stream JSON behavior remains unchanged.

Run: `pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts`

Expected: FAIL because `streamAgentMessage` does not exist.

- [x] **Step 2: Implement BFF streaming proxy**

Return the Agent response body directly with `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, and request id propagation.

- [x] **Step 3: Verify**

Run: `pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts`

Expected: PASS.

### Task 5: assistant-ui AG-UI Streaming Adapter

**Files:**
- Modify: `components/agent/agent-runtime-provider.tsx`
- Modify: `components/agent/agent-panel.tsx`
- Test: `tests/unit/agent-panel-assistant-ui.test.tsx`
- Test: `tests/unit/agent-panel.test.tsx`

- [x] **Step 1: Write failing tests**

Test behaviors:

- Composer sends `Accept: text/event-stream`.
- Assistant message updates from streamed AG-UI `TEXT_MESSAGE_CONTENT` events.
- Tool cards and confirmation cards render from AG-UI `TOOL_CALL_*` metadata.
- Abort/cancel stops the stream without writing operations to RHF.

Run: `pnpm vitest run tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-panel.test.tsx`

Expected: FAIL because the panel still expects JSON.

- [x] **Step 2: Implement async generator adapter**

Change the `ChatModelAdapter.run()` implementation to `async function*`, yielding progressive text content to assistant-ui. Keep AG-UI tool operation cards in Web state after stream events arrive.

- [x] **Step 3: Verify**

Run: `pnpm vitest run tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-panel.test.tsx`

Expected: PASS.

### Task 6: Mobile Agent Sheet

**Files:**
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx`
- Modify: `components/agent/agent-panel.tsx` if sizing hooks are needed.
- Test: `tests/unit/editor-client-live-preview.test.tsx`

- [x] **Step 1: Write failing tests**

Test behaviors:

- On mobile, `Agent 模式` opens an Agent Sheet-like panel.
- Closing the mobile panel preserves unsaved form values.
- Applying a streamed operation still writes via RHF and flushes autosave.

Run: `pnpm vitest run tests/unit/editor-client-live-preview.test.tsx`

Expected: FAIL because mobile Agent Mode is not implemented.

- [x] **Step 2: Implement mobile Sheet**

Use existing UI primitives where available. The panel must be fixed, scrollable, and dismissible, and must not unmount `FormProvider`.

- [x] **Step 3: Verify**

Run: `pnpm vitest run tests/unit/editor-client-live-preview.test.tsx`

Expected: PASS.

### Task 7: Docs, Stability, and Full Verification

**Files:**
- Modify: `docs/agent/service-contracts.md`
- Modify: `docs/agent/frontend-integration.md`
- Modify: `docs/agent/assistant-ui-research.md`
- Modify: `docs/agent/implementation-roadmap.md`

- [x] **Step 1: Update docs**

Document AG-UI stream events, Web BFF streaming proxy, LocalRuntime async generator choice, minimal resume operation tools, mobile Sheet behavior, and deployment buffering notes.

- [x] **Step 2: Run full gates**

Run:

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
pnpm agent:build
```

Expected: all pass. Existing lint warnings may remain if unchanged.

Verified on 2026-06-09:

- `pnpm test`: 69 Web test files / 335 tests passed; 9 Agent test files / 67 tests passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm lint`: passed with 10 existing warnings and 0 errors.
- `pnpm build`: passed; build logged expected placeholder `DATABASE_URL` template query failures but exited 0.
- `pnpm agent:build`: passed.

- [ ] **Step 3: Commit**

Commit with:

```bash
git add .
git commit -m "feat(agent): stream assistant-ui agent mode"
```
