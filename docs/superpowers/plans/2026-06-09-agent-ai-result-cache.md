# Agent AI Result Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Redis-backed AI result caching for Agent generation endpoints so unchanged inputs do not call the model provider again.

**Architecture:** Add a small Agent-side cache module responsible for stable cache keys, Redis get/set, TTLs, and safe JSON envelopes. Inject it into `createAgentServer`, check it after auth/validation/provider availability and before rate limit/provider calls, then return cached responses with current request id.

**Tech Stack:** Node/TypeScript Agent service, Redis, Next.js Route Handlers, Vitest.

---

### Task 1: Agent Cache Primitive

**Files:**
- Create: `apps/agent/src/ai-cache.ts`
- Test: `apps/agent/tests/ai-cache.test.ts`

- [x] Write tests for stable cache keys and Redis get/set serialization.
- [x] Implement `buildAiCacheKey`, scope TTLs, and `createRedisAiCacheStore`.
- [x] Verify `pnpm --filter @intro-builder/agent test -- ai-cache`.

### Task 2: Agent HTTP Cache Integration

**Files:**
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/src/index.ts`
- Test: `apps/agent/tests/http.test.ts`

- [x] Write failing HTTP tests proving rich text polish, resume helpers, and agent messages reuse cached results without a second provider call.
- [x] Inject optional `aiCacheStore` into `createAgentServer`.
- [x] Check cache before rate limit; on miss, store parsed provider result.
- [x] Verify targeted Agent tests.

### Task 3: Web Contract Pass-through

**Files:**
- Modify: `lib/agent/client.ts`
- Modify: `lib/agent/agent-message-contract.ts`
- Modify: `app/api/agent/rich-text/polish/route.ts`
- Modify: `app/api/agent/resume/helpers/[helperId]/route.ts`
- Modify: `app/api/agent/messages/route.ts`
- Test: `tests/unit/agent-rich-text-polish-route.test.ts`
- Test: `tests/unit/agent-resume-helper-route.test.ts`
- Test: `tests/unit/agent-messages-route.test.ts`

- [x] Add optional `cached`/`cachedAt` response metadata types.
- [x] Pass cache metadata through Web BFF responses when present.
- [x] Verify affected Web route tests.

### Task 4: Verification and PR

- [x] Run `pnpm test`.
- [x] Run `pnpm tsc --noEmit`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.
- [ ] Commit with Conventional Commit message.
- [ ] Push branch and create a PR.
