# Floating Agent Approval Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `直接修改` and `请求批准` modes to the floating resume assistant without touching `AgentPanel`.

**Architecture:** Keep direct mode backward compatible. In approval mode, the AI SDK route still builds `ResumeOperation`s, but streams them as approval requests rather than direct `operations`; `FloatingAgentChat` renders approval cards and only applies operations after user approval.

**Tech Stack:** Next.js 16 App Router route handlers, Vercel AI SDK, React 19, Tailwind v4, Vitest, Testing Library.

---

### Task 1: Shared Approval Types

**Files:**
- Modify: `packages/shared/src/types/agent.ts`

- [x] **Step 1: Add write mode and approval request types**

Add:

```ts
export type AgentWriteMode = "direct" | "approval";

export type AgentOperationApprovalRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: "approval_required";
  message: string;
  toolCallId: string | null;
  source: { kind: "tool" | "skill"; name: string };
  operation: ResumeOperation;
};
```

### Task 2: Backend Approval Events

**Files:**
- Modify: `apps/web/app/api/agent/floating/chat/route.ts`
- Test: `apps/web/tests/unit/agent-floating-chat-route.test.ts`

- [x] **Step 1: Write failing backend test**

Add a test that sends `writeMode: "approval"` and uses a block-level mutating tool
such as `updateWorkExperienceBlock`. Assert:

- the `tool-call-result` event has `operations: []`,
- an `approval-request` event exists,
- the final `done` event has `operations: []`,
- the final `done` event has `approvalRequests` with the operation.

- [x] **Step 2: Implement backend mode parsing**

Add `writeMode?: AgentWriteMode` to the request body and default invalid/missing values to `"direct"`.

- [x] **Step 3: Gate operation emission**

In `createFloatingChatEventStream`, when `writeMode === "approval"` and an executed tool has an operation:

- build `AgentOperationApprovalRequest`,
- append an approval message part,
- send `approval-request`,
- do not include the operation in direct `operations`.

### Task 3: Floating Chat Mode UI

**Files:**
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing UI test**

Add tests for:

- default mode renders `直接修改`,
- switching to `请求批准` persists and sends `writeMode: "approval"`,
- the switch is disabled during loading.

- [x] **Step 2: Add mode state**

Use localStorage key:

```ts
intro-builder.agent.floating.operation-mode.v1
```

Add a compact segmented control in the composer footer.

- [x] **Step 3: Include mode in requests**

Send `writeMode` in `/api/agent/floating/chat` request body.

### Task 4: Approval Cards

**Files:**
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Reuse: `apps/web/components/agent/agent-confirmation-card.tsx`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] **Step 1: Write failing approval behavior test**

In approval mode, mock `/api/agent/floating/chat` to return an approval request. Assert:

- `applyOperation` is not called before approval,
- an approval card appears,
- clicking `应用` calls `applyOperation` once and `flushAutosave` once,
- no second `/api/agent/floating/chat` call is made.

- [x] **Step 2: Extend floating message parts**

Add approval parts:

```ts
type FloatingAgentMessagePart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "tool"; toolCall: FloatingAgentToolCall }
  | { id: string; type: "approval"; approvalRequest: AgentOperationApprovalRequest };
```

- [x] **Step 3: Parse approval events**

Handle `approval-request` SSE events and `done.approvalRequests`.

- [x] **Step 4: Render approval card**

Render `AgentConfirmationCard` inside assistant messages for approval parts.

### Task 5: Verification

**Files:**
- Verify all touched files.

- [x] **Step 1: Run focused tests**

```bash
pnpm --filter @intro-builder/web test tests/unit/agent-floating-chat-route.test.ts tests/unit/agent-panel-assistant-ui.test.tsx -- --run
```

- [x] **Step 2: Run gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
