# Agent Security and Session Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the current Agent Mode BYOK, provider, session, and stream-timeout boundaries so the branch is safe to continue toward an AI SDK runtime.

**Architecture:** Keep the existing Web BFF -> Agent service -> AG-UI stream path. Change browser storage to session-scoped secrets, validate request-scoped model endpoints in the Agent service, derive create-from-zero sessions from user/thread identity, and make streaming timeouts idle-based instead of total-duration-based.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, assistant-ui, AG-UI, Node Agent service, Vitest, TypeScript.

---

## File Structure

- Modify `apps/web/components/agent/agent-panel.tsx`: stop writing API keys to localStorage and hydrate them from sessionStorage.
- Modify `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`: assert API keys are not persisted in localStorage and still flow in the current request.
- Modify `apps/agent/src/agent-messages.ts`: add request model config validation for safe provider base URLs.
- Modify `apps/agent/tests/agent-messages.test.ts`: assert unsafe model URLs fail validation.
- Modify `apps/agent/tests/http.test.ts`: assert unsafe model URLs do not trigger provider fetch.
- Modify `apps/web/app/api/agent/runs/route.ts`: derive create-from-zero session/thread ids from user id and AG-UI thread id.
- Modify `apps/web/tests/unit/agent-runs-route.test.ts`: assert create-from-zero sessions differ across users and threads.
- Modify `apps/web/lib/agent/client.ts`: clear stream connection timeout after response and add idle timeout per chunk.
- Modify `apps/web/tests/unit/agent-client.test.ts`: assert stream reads can continue after the initial timeout when chunks keep arriving.

## Task 1: Make Browser API Keys Session-Scoped

- [x] **Step 1: Write failing UI persistence test**

  In `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`, extend the model settings test to save a key, send a message, and assert:

  ```ts
  expect(window.localStorage.getItem("intro-builder.agent.model-settings.v1")).not.toContain("sk-test-local");
  expect(window.sessionStorage.getItem("intro-builder.agent.model-api-key.v1")).toBe("sk-test-local");
  ```

- [x] **Step 2: Run red test**

  Run:

  ```bash
  pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx
  ```

  Expected: FAIL because the key is currently stored in localStorage.

- [x] **Step 3: Implement session-scoped key storage**

  Update `agent-panel.tsx` so `localStorage` stores only non-secret model settings and `sessionStorage` stores the API key.

- [x] **Step 4: Run green test**

  Run the same focused test. Expected: PASS.

## Task 2: Reject Unsafe Provider URLs

- [x] **Step 1: Write failing validation tests**

  In `apps/agent/tests/agent-messages.test.ts`, add cases for `http://127.0.0.1:11434/v1`, `http://169.254.169.254/latest`, `file:///tmp/model`, and `not a url`, expecting `validateAgentMessageRequest()` to fail.

- [x] **Step 2: Write failing HTTP no-fetch test**

  In `apps/agent/tests/http.test.ts`, post an Agent request with `modelConfig.baseUrl = "http://127.0.0.1:11434/v1"` and assert the response is `400` and the provider fetch mock is not called.

- [x] **Step 3: Run red tests**

  Run:

  ```bash
  pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/http.test.ts
  ```

  Expected: FAIL because unsafe URLs are currently accepted.

- [x] **Step 4: Implement URL guard**

  Add URL parsing and literal host checks in `agent-messages.ts` before returning `modelConfig`.

- [x] **Step 5: Run green tests**

  Run the same focused Agent tests. Expected: PASS.

## Task 3: Make Create-From-Zero Sessions Unique

- [x] **Step 1: Write failing route tests**

  In `apps/web/tests/unit/agent-runs-route.test.ts`, add coverage showing:

  - user `user_123`, thread `thread_a` gets one create-from-zero session id,
  - user `user_123`, thread `thread_b` gets a different session id,
  - user `user_456`, thread `thread_a` gets a different session id.

- [x] **Step 2: Run red test**

  Run:

  ```bash
  pnpm --filter @intro-builder/web test -- tests/unit/agent-runs-route.test.ts
  ```

  Expected: FAIL because the route currently returns `agent_session_create_from_zero`.

- [x] **Step 3: Implement user/thread-derived ids**

  Update `agentRunSessionId()` and `agentRunThreadId()` to use input thread ids for create-from-zero and hash the user id for the session id.

- [x] **Step 4: Run green test**

  Run the same focused route test. Expected: PASS.

## Task 4: Make Streaming Timeout Idle-Based

- [x] **Step 1: Write failing long-stream test**

  In `apps/web/tests/unit/agent-client.test.ts`, add a test with `streamTimeoutMs: 10` where chunks arrive every 6ms for longer than 10ms total. The stream should finish and the upstream signal should not be aborted.

- [x] **Step 2: Run red test**

  Run:

  ```bash
  pnpm --filter @intro-builder/web test -- tests/unit/agent-client.test.ts
  ```

  Expected: FAIL because the current timer stays active for total stream duration.

- [x] **Step 3: Implement idle stream timeout**

  Clear the initial timeout after headers are received. Wrap stream reads with a timer that resets after each chunk and aborts only when no chunk arrives within `streamTimeoutMs`.

- [x] **Step 4: Run green test**

  Run the same focused test. Expected: PASS.

## Task 5: Verification and PR

- [x] **Step 1: Run focused tests**

  ```bash
  pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/http.test.ts
  pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-runs-route.test.ts tests/unit/agent-client.test.ts
  ```

- [x] **Step 2: Run project gates**

  ```bash
  pnpm test
  pnpm tsc --noEmit
  pnpm lint
  pnpm build
  ```

- [x] **Step 3: Browser smoke**

  Run Web and Agent dev servers, open `/resume/dev-resume-agent-preview/edit`, send one Agent message, verify the panel streams, the context circle remains compact, and no key appears in localStorage.

- [ ] **Step 4: Commit and PR**

  Stage only the Agent/security/session files, commit with:

  ```bash
  git commit -m "fix(agent): harden byok and session boundaries"
  ```

  Push the current branch and open a PR against `origin/main`.

## Execution Notes

- Focused tests passed:
  - `pnpm --filter @intro-builder/agent test -- tests/agent-messages.test.ts tests/http.test.ts`
  - `pnpm --filter @intro-builder/web test -- tests/unit/agent-panel-assistant-ui.test.tsx tests/unit/agent-runs-route.test.ts tests/unit/agent-client.test.ts`
- Full repository verification passed with `pnpm verify` (`lint`, `typecheck`, `test`, `build`).
- `pnpm tsc --noEmit` at the repository root currently fails before this slice's code is reached because the root `tsconfig.json` includes stale root `.next` generated types and all workspace files with root-scoped path aliases. CI uses `pnpm typecheck`, which passed.
- Browser smoke passed on `/resume/dev-resume-agent-preview/edit`: Agent panel opened, compact context ring rendered, a short Agent message returned an answerable question card, and the UI stayed on the Web BFF path.
