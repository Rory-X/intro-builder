# Floating Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an env-gated floating resume assistant while preserving the existing Agent Panel fallback.

**Architecture:** Server-side env parsing selects an agent surface for the edit page. The floating branch uses `AgentBubble`, a dedicated `FloatingAgentChat` component, and a Web-local Next route with request-scoped model configuration and no default model.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, OpenAI-compatible chat completions, Tailwind v4, Vitest.

---

### Task 1: Env-Gated Surface Selection

**Files:**
- Create: `apps/web/lib/agent/surface.ts`
- Modify: `apps/web/app/(app)/resume/[id]/edit/page.tsx`
- Test: `apps/web/tests/unit/agent-surface.test.ts`

- [x] **Step 1: Write failing tests**

```ts
expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "floating" })).toBe("floating");
expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "panel" })).toBe("panel");
```

- [x] **Step 2: Implement parser**

`readAgentSurface()` returns `"floating"` only for `floating`, and `"panel"` otherwise, preferring `AGENT_ASSISTANT_SURFACE` over `NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE`.

- [x] **Step 3: Pass surface into edit client**

`page.tsx` imports `readAgentSurface()` and passes `agentSurface={readAgentSurface()}` into `EditorClient`.

### Task 2: Floating Shell Mount

**Files:**
- Modify: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`
- Modify: `apps/web/components/agent/agent-bubble.tsx`
- Test: `apps/web/tests/unit/editor-client-live-preview.test.tsx`
- Test: `apps/web/tests/unit/agent-bubble.test.tsx`

- [x] **Step 1: Write failing editor test**

Render `EditorClient agentSurface="floating"` and assert the old `Agent 模式` entry is hidden while the floating assistant button/window are present.

- [x] **Step 2: Implement `AgentBubble` shell**

Use a fixed 56px draggable bubble, a 440x620 desktop window, responsive mobile sizing, gradient title bar, minimize action, and persisted bubble position in `localStorage`.

- [x] **Step 3: Mount floating assistant**

In floating mode, render:

```tsx
<AgentBubble title="AI 简历助手">
  <FloatingAgentChat />
</AgentBubble>
```

### Task 3: Floating Chat UI

**Files:**
- Create: `apps/web/components/agent/floating-agent-chat.tsx`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing chrome test**

Render `FloatingAgentChat` and assert no old `返回编辑`, resume-title dropdown, model settings button, manual toggle, or scroll-to-bottom controls appear. Assert `历史对话`, `新对话`, and `当前模型：连接模型` appear.

- [x] **Step 2: Write failing copy test**

Send a message without model configuration and assert the assistant says `需要先连接模型`, offers `连接模型`, does not call fetch, and the rendered UI contains no implementation or experiment keywords.

- [x] **Step 3: Implement dedicated floating UI**

Render compact header controls, local message list, avatar bubbles, a model connection pill, and a dialog for model service address, access key, and model name.

### Task 4: Local Route And Tool Operations

**Files:**
- Create: `apps/web/app/api/agent/floating/chat/route.ts`
- Test: `apps/web/tests/unit/agent-floating-chat-route.test.ts`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing route tests**

Assert the route requires a Web user, requires model configuration, constructs
the model client from request data only, streams text/tool events in order, and
returns `ResumeOperation` objects from semantic resume tool calls.

- [x] **Step 2: Implement route**

Use the Next Node runtime, normalize the request-scoped model configuration,
send the current resume context, declare semantic tools such as
`readResume`, `updateSection`, `addSection`, `rewriteText`, `suggestSkills`,
and `analyzeJobMatch`, then map applicable tool-call arguments into
`ResumeOperation`.

- [x] **Step 3: Apply operations in the editor**

After `/api/agent/floating/chat` returns, call `applyOperation(operation)` for every operation and call `flushAutosave()` once when at least one operation was applied.

### Task 5: Fetch Models From Connection Settings

**Files:**
- Create: `apps/web/app/api/agent/floating/models/route.ts`
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Test: `apps/web/tests/unit/agent-floating-models-route.test.ts`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing route test**

Assert `/api/agent/floating/models` requires a Web user, requires model service
address and access key, constructs the model client from request data only, and
returns deduped model options.

- [x] **Step 2: Write failing UI test**

Open `FloatingAgentChat` model connection dialog, fill model service address and
access key, click `获取模型`, select a returned model, save it, and assert the
selected model appears in the composer pill and is persisted in browser storage.

- [x] **Step 3: Implement route and UI**

The route calls `client.models.list()` using only request-scoped connection
settings. The dialog shows a `获取模型` button, loading state, error state, and a
`选择模型` native select when models are returned.

### Task 6: Floating Session History

**Files:**
- Modify: `apps/web/db/schema.ts`
- Create: `apps/web/db/migrations/0012_add_floating_agent_chat_sessions.sql`
- Create: `apps/web/lib/agent/floating-chat-session-store.ts`
- Create: `apps/web/app/api/agent/floating/sessions/route.ts`
- Create: `apps/web/app/api/agent/floating/sessions/[sessionId]/route.ts`
- Modify: `apps/web/app/api/agent/floating/chat/route.ts`
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Test: `apps/web/tests/unit/agent-floating-sessions-route.test.ts`
- Test: `apps/web/tests/unit/agent-floating-chat-route.test.ts`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing session route tests**

Assert the list/create session route requires a user and resume id, returns
owned sessions, and creates a fresh `新对话` session. Assert the session detail
route loads messages through a Next 16 async `params` context and deletes an
owned session.

- [x] **Step 2: Implement DB-backed session store**

Add floating-only session/message tables, Drizzle schema entries, migration SQL,
and store helpers for list/create/get/delete/list-messages/append/rename.

- [x] **Step 3: Wire chat persistence**

Accept `sessionId` in `/api/agent/floating/chat`, verify ownership and resume
match, persist the latest user message before the model call, rename the initial
session from the first user message, and persist assistant text plus ordered
text/tool parts after the model call.

- [x] **Step 4: Wire floating UI history**

On mount, list sessions for the current resume; load the latest session's
messages or create a session when none exists. The history popover switches and
deletes sessions, and the new-chat action creates a fresh session. Chat sends
the active `sessionId`.

### Task 7: Verification

**Files:**
- Modify: `docs/agent/code-map.md`
- Modify: `docs/agent/development.md`

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @intro-builder/web test -- apps/web/tests/unit/agent-floating-sessions-route.test.ts apps/web/tests/unit/agent-floating-models-route.test.ts apps/web/tests/unit/agent-floating-chat-route.test.ts apps/web/tests/unit/agent-panel-assistant-ui.test.tsx apps/web/tests/unit/editor-client-live-preview.test.tsx apps/web/tests/unit/agent-bubble.test.tsx --runInBand
```

Expected: exit 0.

Observed: exit 0 after adding the floating session routes, session persistence,
floating chat, local chat route, and model list route tests.

- [x] **Step 2: Run full gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0.

Observed after session history and hydration fixes:

- `pnpm test`: exit 0. Agent package: 18 files / 171 tests passed. Web app:
  104 files / 527 tests passed, 1 skipped.
- `pnpm typecheck`: exit 0 across agent, shared, partykit, and web packages.
- `pnpm lint`: exit 0 with 12 existing warnings and 0 errors.
- `pnpm build`: exit 0. Build output includes
  `/api/agent/floating/sessions` and
  `/api/agent/floating/sessions/[sessionId]`.

- [x] **Step 3: Visual smoke**

Start the web app with:

```bash
AGENT_ASSISTANT_SURFACE=floating AUTH_DEV_BYPASS=1 AUTH_DEV_USER_ID=dev-user pnpm dev:web
```

Open an edit page and verify the floating bubble opens a compact chat window, no implementation or experiment keywords are visible, a missing model shows `需要先连接模型`, and `AGENT_ASSISTANT_SURFACE` unset falls back to the existing Agent Panel.

Observed after session history and hydration fixes:
`http://localhost:3001/resume/dev-resume-agent-preview/edit?from=dashboard`
with `AGENT_ASSISTANT_SURFACE=floating` shows the floating assistant entry,
hides the old Agent mode entry, and contains no implementation or experiment
keywords. Opening the assistant shows history/new-chat/model controls. The
history popover showed `1 个对话` after mount created a session, then `2 个对话`
after clicking `新对话`. Clearing model settings and sending a message showed
`需要先连接模型` locally; server logs showed no `/api/agent/floating/chat` request.
Restarting without `AGENT_ASSISTANT_SURFACE` showed the existing Agent Panel
entry and no floating entry. The local server was restored to
`AGENT_ASSISTANT_SURFACE=floating` on port 3001.
