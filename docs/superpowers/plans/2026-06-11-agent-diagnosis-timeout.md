# Agent Diagnosis Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce AI resume diagnosis failures caused by the Web proxy timing out before the Agent model call finishes.

**Architecture:** Keep lightweight Agent JSON calls on the existing 10 second timeout, and introduce a separate generation timeout for non-streaming model-backed JSON calls. Align the Agent service provider timeout with the same 90 second generation budget. Preserve provider error redaction while mapping timeout codes to a user-actionable Chinese message.

**Tech Stack:** Next.js App Router route handlers, React client component, Vitest, Testing Library.

---

### Task 1: Client Generation Timeout

**Files:**
- Modify: `lib/agent/client.ts`
- Test: `tests/unit/agent-client.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving `runResumeHelper()` and `polishRichText()` use a longer generation timeout instead of the default JSON timeout.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm test -- --run tests/unit/agent-client.test.ts
```

Expected: new timeout tests fail because `runResumeHelper()` / `polishRichText()` still abort after `timeoutMs`.

- [x] **Step 3: Implement minimal client change**

Add `generationTimeoutMs` to `CreateAgentClientOptions`, default it from `AGENT_GENERATION_TIMEOUT_MS` or 90000, and pass it to `runResumeHelper()` and `polishRichText()`.

- [x] **Step 4: Verify GREEN**

Run the same test file and confirm it passes.

### Task 2: Timeout Error Message

**Files:**
- Modify: `app/api/agent/resume/helpers/[helperId]/route.ts`
- Modify: `components/agent/resume-diagnose-button.tsx`
- Test: `tests/unit/agent-resume-helper-route.test.ts`
- Test: `tests/unit/resume-diagnose-button.test.tsx`

- [x] **Step 1: Write failing tests**

Add route and UI tests proving `agent_timeout` / `provider_timeout` show
`AI 生成超时，请稍后重试或减少简历内容后再试`.
Also assert the helper route exports `maxDuration = 120`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm test -- --run tests/unit/agent-resume-helper-route.test.ts tests/unit/resume-diagnose-button.test.tsx
```

Expected: new tests fail because the route/UI still show generic service unavailable text.

- [x] **Step 3: Implement minimal route/UI mapping**

Map timeout codes to the new message, leave other Agent errors redacted as `Agent 服务暂不可用`, and export `maxDuration = 120`.

- [x] **Step 4: Verify GREEN**

Run the same test files and confirm they pass.

### Task 3: Documentation And Gates

**Files:**
- Modify: `.env.example`
- Modify: `apps/agent/.env.example`
- Modify: `apps/agent/src/config.ts`
- Test: `apps/agent/tests/config.test.ts`

- [x] **Step 1: Update Agent service timeout test**

Update `apps/agent/tests/config.test.ts` so the empty env default expects `modelTimeoutMs: 90_000`.

- [x] **Step 2: Implement Agent service default**

Change the `AGENT_MODEL_TIMEOUT_MS` fallback in `apps/agent/src/config.ts` from `20_000` to `90_000`.

- [x] **Step 3: Document env knobs**

Add `AGENT_GENERATION_TIMEOUT_MS="90000"` next to existing Agent timeout settings.
Change `apps/agent/.env.example` to `AGENT_MODEL_TIMEOUT_MS=90000`.

- [x] **Step 4: Run verification gates**

Run:

```bash
pnpm exec vitest run tests/unit/agent-client.test.ts tests/unit/agent-resume-helper-route.test.ts tests/unit/resume-diagnose-button.test.tsx
pnpm --filter @intro-builder/agent test -- --run apps/agent/tests/config.test.ts
pnpm tsc --noEmit
pnpm lint
```

If build time permits, run `pnpm build` because this touches an App Router route.
