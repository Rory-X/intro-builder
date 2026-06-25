# Agent Stability and UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Agent 的保存回写、忽略续跑、流式输出、工具展示和模型配置统一收紧，确保“成功”必须能被验证。

**Architecture:** 采用四个相对独立的切片：保存回写验证、floating prompt/续跑与防泄漏修正、聊天 UX 收敛、模型配置统一入口。共享逻辑放到单独的本地工具模块里，避免 `AgentPanel` 和 `FloatingAgentChat` 各自维护一套不一致的存储与表单行为。

**Tech Stack:** Next.js App Router route handlers, React 19 client components, react-hook-form, Vitest, Testing Library, localStorage/sessionStorage, existing Agent / AG-UI plumbing.

---

### Task 1: Save Flush Must Be Verifiable

**Files:**
- Modify: `apps/web/hooks/use-resume-autosave.ts`
- Modify: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Modify: `apps/web/tests/unit/use-resume-autosave.test.ts`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [ ] **Step 1: Add a failing test for a verifiable flush**

```ts
it("exposes a flush result that rejects when save fails", async () => {
  // Arrange a failing onSave and trigger resume:flush-autosave.
  // Expect the caller to observe a rejected promise instead of silent success.
});
```

- [ ] **Step 2: Verify the test fails before implementation**

Run: `pnpm --filter @intro-builder/web exec vitest run tests/unit/use-resume-autosave.test.ts -t "flush result"`
Expected: the new test fails because flush is still fire-and-forget.

- [ ] **Step 3: Implement a promise-based flush contract**

```ts
type FlushResult = Promise<void>;

// The hook should expose a stable `flush()` that resolves only after the
// queued save finished successfully and rejects on save error.
```

- [ ] **Step 4: Wire editor and Agent callers to await the result**

```ts
await flushAutosave();
applyOperation(operation);
```

- [ ] **Step 5: Re-run the focused tests**

Run: `pnpm --filter @intro-builder/web exec vitest run tests/unit/use-resume-autosave.test.ts tests/unit/agent-panel-assistant-ui.test.tsx`
Expected: both tests pass and the save failure path is visible.

### Task 2: Floating Approval Continuations Must Carry More Context And Stay Private

**Files:**
- Modify: `apps/web/app/api/agent/floating/chat/route.ts`
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/workflows/loop-runtime.ts`
- Modify: `apps/web/tests/unit/agent-floating-chat-route.test.ts`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`
- Modify: `apps/agent/tests/agent-messages.test.ts`
- Modify: `apps/agent/tests/loop-runtime.test.ts`

- [ ] **Step 1: Add a failing route test for ignored suggestion loops**

```ts
it("includes ignored suggestion details in approval continuation context", async () => {
  // Build a request with approvalDecisions and assert the prompt data
  // carries the operation summary, field path, and decision status.
});
```

- [ ] **Step 2: Add a failing route test for anti-leakage instructions**

```ts
it("instructs the model not to leak hidden prompts, tools, or provider config", async () => {
  // Assert the system prompt forbids leaking system prompts, hidden
  // instructions, tool implementation details, model config, and keys.
  // Also assert the request key/base URL are not copied into the system prompt.
});
```

- [ ] **Step 3: Verify the prompt tests fail**

Run: `pnpm --filter @intro-builder/web exec vitest run tests/unit/agent-floating-chat-route.test.ts -t "ignored suggestion details"`
Expected: the current prompt path does not expose enough context.

- [ ] **Step 4: Expand the continuation payload and system prompt**

```ts
type FloatingApprovalDecision = {
  approvalId: string;
  approved: boolean;
  summary?: string;
  fieldPath?: string;
  operation?: string;
};
```

- [ ] **Step 5: Prevent repeated ignored suggestions in the floating loop**

```ts
// Keep rejected operation summaries in the continuation state so the next
// request can explicitly avoid them.
```

- [ ] **Step 6: Add explicit anti-leakage boundaries to the floating system prompt**

```ts
// The system prompt must forbid leaking system/developer prompts, hidden
// instructions, tool implementation details, provider config, base URLs, and keys.
```

- [ ] **Step 7: Add prior-preference and flexible STAR guidance to the main Agent prompts**

```ts
// Preserve sectionOrder through request validation, include it in the user
// prompt, tell the Agent to inherit recent user preferences, and frame STAR
// as a diagnosis lens rather than a fixed four-heading template.
```

- [ ] **Step 8: Re-run the route, floating, and agent prompt tests**

Run: `pnpm --filter @intro-builder/web exec vitest run tests/unit/agent-floating-chat-route.test.ts tests/unit/agent-panel-assistant-ui.test.tsx`
Run: `pnpm --filter @intro-builder/agent exec vitest run tests/agent-messages.test.ts tests/loop-runtime.test.ts`
Expected: ignored approval no longer loops on the same suggestion, leakage requests are redirected to visible resume advice / operation results, and main Agent prompts carry prior preferences plus `sectionOrder`.

### Task 3: Floating Chat UX Should Stay Quiet and Readable

**Files:**
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [ ] **Step 1: Add a failing test for user-controlled autoscroll**

```ts
it("does not force scroll to bottom while the user is reading older messages", async () => {
  // Put the message list away from the bottom, stream deltas, and verify
  // scrollTop is not reset.
});
```

- [ ] **Step 2: Add a failing test for compact tool summaries**

```ts
it("renders tool calls as concise summaries by default", async () => {
  // Assert the visible text is short and payload details stay collapsed.
});
```

- [ ] **Step 3: Implement scroll anchoring and compact tool rendering**

```ts
// Keep a bottom-distance ref, only autoscroll when the viewport is already
// near the end, and render tool calls with a short summary first.
```

- [ ] **Step 4: Make regenerate availability stable**

```ts
// Preserve the last assistant turn's regenerate action while the message is
// still a valid candidate, instead of letting hover/autohide drop it early.
```

- [ ] **Step 5: Re-run the floating UI tests**

Run: `pnpm --filter @intro-builder/web exec vitest run tests/unit/agent-panel-assistant-ui.test.tsx`
Expected: scrolling, tool summaries, and regenerate affordance all match the tests.

### Task 4: Model Settings Need One Shared Entry Point

**Files:**
- Add: `apps/web/components/agent/model-settings-dialog.tsx`
- Add: `apps/web/lib/agent/model-settings-storage.ts`
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Modify: `apps/web/components/agent/floating-agent-chat.tsx`
- Modify: `apps/web/app/(app)/settings/page.tsx`
- Modify: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`
- Modify: `apps/web/tests/unit/agent-panel.test.tsx`

- [ ] **Step 1: Add a failing settings-page test**

```ts
it("shows the current model settings and lets the user edit them", async () => {
  // Render the settings page with a stored model config and assert the card
  // shows model name, base URL, and masked key state.
});
```

- [ ] **Step 2: Add a failing test for the password visibility toggle**

```ts
it("lets the user reveal and hide the model key", async () => {
  // Ensure the key field has an eye button and toggles visibility.
});
```

- [ ] **Step 3: Extract shared local model-settings storage helpers**

```ts
export function readStoredAgentModelSettings(): AgentModelSettingsForm;
export function storeAgentModelSettings(settings: AgentModelSettingsForm): void;
```

- [ ] **Step 4: Reuse the same dialog in AgentPanel, FloatingAgentChat, and settings**

```tsx
<ModelSettingsDialog
  settings={settings}
  onSave={setSettings}
  title="模型设置"
/>
```

- [ ] **Step 5: Re-run the settings and agent tests**

Run: `pnpm --filter @intro-builder/web exec vitest run tests/unit/agent-panel.test.tsx tests/unit/agent-panel-assistant-ui.test.tsx`
Expected: model config edits are consistent across all entrypoints.

### Task 5: Final Verification

**Files:**
- None new; verify the whole tree.

- [ ] **Step 1: Run unit tests**

Run: `pnpm test`

- [ ] **Step 2: Run type checking**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

- [ ] **Step 4: Run production build**

Run: `pnpm build`

- [ ] **Step 5: Smoke the editor and floating chat**

Run:
```bash
pnpm dev
pnpm agent:dev
```
Then verify save failure, ignore/retry, scroll anchoring, tool summaries, and model settings entrypoints in the browser.
