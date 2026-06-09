# Agent Realtime Streaming Stability Phase 3C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Mode feel like ChatGPT with true provider-token streaming while hardening the Web BFF -> Agent SSE path against cache, timeout, and mid-stream error failures.

**Architecture:** Keep the current trust boundary: Browser calls the Next.js Web BFF, Web signs a short-lived `agent:chat` JWT after Auth.js and resume ownership checks, and Agent returns AG-UI `text/event-stream`. Phase 3C first stabilizes the current LocalRuntime/custom adapter path, then evaluates `@ag-ui/client` + `@assistant-ui/react-ag-ui` as a small, reversible runtime adapter patch rather than a broad rewrite.

**Tech Stack:** Next.js 16 Route Handlers with Web `Request`/`Response`/`ReadableStream`, Node Agent service, `@ag-ui/core`, `@ag-ui/encoder`, assistant-ui `LocalRuntime`, OpenAI-compatible streaming chat completions, Vitest.

---

## Non-Negotiable Boundaries

- Existing OCR, resume import, and AI parsing stay out of this Agent microservice work.
- Browser still calls the Web BFF (`/api/agent/runs` for Agent panel); it must not directly call the Agent deployment URL in Phase 3C.
- Web owns Auth.js, resume ownership, short-lived Agent JWT signing, RHF state, autosave, preview, and confirmed operation application.
- Agent owns model provider calls, prompts, AG-UI SSE emission, basic resume tool proposals, Redis rate limit, and AI cache.
- Streaming text chunks never write into RHF. Only confirmed `ResumeOperation` cards may trigger Web writeback.
- The minimum tool set remains `resume_read`, `resume_update_section`, `resume_delete_section`, `resume_reorder_sections`, and `resume_insert_section`.

## Root Cause Notes

- Phase 3B emits multiple `TEXT_MESSAGE_CONTENT` events only after the provider returns a full JSON response. This improves UI perception but is not true token streaming.
- Agent `agent:chat` cache hits currently return JSON even when the request asks for `text/event-stream`; that breaks the browser-side AG-UI parser.
- Web `requestStream()` currently shares the non-stream 10s timeout; the abort timer can kill a valid long-running stream after headers arrive.
- Provider or parse failures after an SSE response starts must be represented as AG-UI `RUN_ERROR`, not as a broken socket with a generic "Agent 服务暂不可用".
- SDK migration is useful for session/event robustness, but direct `HttpAgent` adoption is not drop-in because AG-UI `RunAgentInput` does not include the current business payload shape (`resumeId`, `workflowId`, capped resume `context`) without an adapter.

## Task 1: Agent SSE Cache and Error Stability

**Files:**

- Modify: `apps/agent/src/http.ts`
- Modify if needed: `apps/agent/src/agent-messages.ts`
- Test: `apps/agent/tests/http.test.ts`
- Test if needed: `apps/agent/tests/agent-messages.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for:

- `POST /v1/agent/messages` with `Accept: text/event-stream` returns AG-UI SSE on cache hit, not JSON.
- The SSE cache-hit event stream includes `RUN_STARTED`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, and `RUN_FINISHED`.
- A provider/parse failure on the SSE product path returns an AG-UI `RUN_ERROR` event with `code`, `message`, and `requestId` metadata instead of silently closing.

Run:

```bash
pnpm --filter @intro-builder/agent test -- http.test.ts agent-messages.test.ts
```

Expected: FAIL before implementation.

- [x] **Step 2: Implement minimal Agent fix**

Keep the same auth, replay guard, request validation, provider configuration, cache lookup, and rate-limit order. When `acceptsAgUiSse(request)` is true:

- Return cached `AgentMessageCacheValue` through `sendAgUiEvents(...)`.
- For non-cached provider output, prefer the streaming provider path from Task 3 when available.
- If an error occurs after the SSE response has started, emit `RUN_ERROR` and close the stream.
- Keep JSON behavior unchanged for `Accept: application/json` and non-SSE debug calls.

- [x] **Step 3: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent test -- http.test.ts agent-messages.test.ts
```

Expected: PASS.

## Task 2: Web Stream Timeout and Error Preservation

**Files:**

- Modify: `lib/agent/client.ts`
- Modify if needed: `app/api/agent/messages/route.ts`
- Test: `tests/unit/agent-client.test.ts`
- Test if needed: `tests/unit/agent-messages-route.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for:

- `streamAgentMessage()` uses a connection/first-response timeout, but does not abort solely because the stream body remains open beyond the JSON timeout.
- Non-stream JSON calls still abort after the configured `timeoutMs`.
- Agent error envelopes preserve `code`, `requestId`, `retryAfterSeconds`, and `dependency`.

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts
```

Expected: FAIL before implementation.

- [x] **Step 2: Implement minimal Web fix**

Separate stream and non-stream timeout semantics:

- Keep `timeoutMs` for JSON/non-stream calls.
- For `requestStream()`, clear the connection timeout immediately after a successful response with a body is received.
- Keep cleanup on body cancel/close for reader resources, but do not keep the JSON timer alive for the full stream.
- Preserve typed `AgentClientError` metadata in route responses.

- [x] **Step 3: Verify**

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts
```

Expected: PASS.

## Task 3: Provider Token Streaming

**Files:**

- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/http.ts`
- Test: `apps/agent/tests/agent-messages.test.ts`
- Test: `apps/agent/tests/http.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for:

- `AgentMessageProvider` may expose a streaming method that yields provider deltas before the final JSON is parsed.
- OpenAI-compatible provider sends `stream: true` when the streaming path is used.
- Agent emits multiple `TEXT_MESSAGE_CONTENT` events before the full provider response is complete.
- Final accumulated JSON is still parsed and validated before emitting tool results and writing cache.

Run:

```bash
pnpm --filter @intro-builder/agent test -- agent-messages.test.ts http.test.ts
```

Expected: FAIL before implementation.

- [x] **Step 2: Implement minimal provider streaming**

Extend the provider interface with an optional stream method, for example:

```ts
stream?: (options: AgentMessageProviderRunOptions) => AsyncIterable<AgentProviderStreamChunk>;
```

For OpenAI-compatible providers:

- Request `/chat/completions` with `stream: true`.
- Accumulate raw JSON text from `choices[].delta.content`.
- Emit safe visible content deltas only from the JSON `message.content` string once extractable.
- At stream end, parse the full accumulated JSON with `parseAgentMessageProviderResponse()`.
- Emit tool call and proposed operation events only after final validation.

If safe incremental extraction cannot confidently find assistant content, fall back to a visible "AI 正在思考" UI state and emit final parsed text chunks. Do not stream raw JSON braces to users.

- [x] **Step 3: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent test -- agent-messages.test.ts http.test.ts
```

Expected: PASS.

## Task 4: assistant-ui / AG-UI SDK Adapter Spike

**Files:**

- Modify: `docs/agent/assistant-ui-research.md`
- Modify: `docs/agent/frontend-integration.md`
- Modify if accepted: `package.json`, `pnpm-lock.yaml`
- Future code seam: `components/agent/agent-runtime-provider.tsx`

- [x] **Step 1: Confirm SDK API from installed package docs**

Inspect `@ag-ui/client` and `@assistant-ui/react-ag-ui` package exports and README before writing code. Do not assume package APIs from memory.

- [x] **Step 2: Decide adapter shape**

Preferred Phase 3C decision:

- Keep Web BFF boundary.
- Add a small adapter route or adapter class that maps assistant-ui/AG-UI run input to the existing `AgentMessageRequest`.
- Pass `resumeId`, `workflowId`, and capped resume `context` from Web-owned state, not from assistant-ui thread state.
- Keep LocalRuntime/custom adapter as fallback until tests prove the SDK runtime can preserve tool cards and confirmation UX.

- [x] **Step 3: Write acceptance tests before migration**

Tests must prove:

- Browser still sends requests to `/api/agent/runs`, not the Agent public URL.
- Runtime cancellation aborts the current stream.
- Tool call results still render confirmation cards.
- No assistant-ui state writes directly to RHF.

## Task 5: Docs and Full Verification

**Files:**

- Modify: `docs/agent/README.md`
- Modify: `docs/agent/service-contracts.md`
- Modify: `docs/agent/security-and-stability.md`
- Modify: `docs/agent/assistant-ui-research.md`
- Modify: `docs/agent/frontend-integration.md`
- Modify: `docs/superpowers/plans/2026-06-09-agent-realtime-streaming-stability-phase-3c.md`

- [x] **Step 1: Update docs**

Record:

- Phase 3C true provider streaming vs Phase 3B provider-response chunking.
- Cache-hit SSE behavior.
- Stream timeout semantics.
- AG-UI `RUN_ERROR` behavior.
- SDK adapter decision and why direct browser-to-Agent remains deferred.

- [x] **Step 2: Run full gates**

Run:

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
pnpm agent:build
```

Expected: all pass. Existing warnings may remain only if unchanged and documented.

Verified on 2026-06-09:

- `pnpm test`: 74 Web test files / 359 tests passed; 10 Agent test files / 81 tests passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm lint`: passed with 10 existing warnings and 0 errors.
- `pnpm build`: passed; build logged expected placeholder `DATABASE_URL` query failures and exited 0.
- `pnpm agent:build`: passed.

## Exit Criteria

- Agent Mode shows incremental assistant text from provider streaming when the provider supports it.
- Cache-hit Agent messages still return AG-UI SSE when the browser requests SSE.
- Long valid streams are not aborted by the JSON 10s timeout after the response body starts.
- Mid-stream provider failures produce an actionable AG-UI error state with request id.
- Web BFF boundary remains intact.
- Resume writeback remains user-confirmed and Web-owned.
