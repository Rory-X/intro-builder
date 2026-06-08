# Rich Text Polish MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1A server-side rich-text polish loop: Web authenticates the user, signs a short Agent JWT, and proxies a STAR-aware polish request to the Agent service.

**Architecture:** The browser talks only to Web routes. Web verifies Auth.js session and resume ownership, validates the polish payload, signs `scope: "rich_text:polish"` with `resumeId`, then calls Agent `POST /v1/rich-text/polish`. Agent verifies JWT/replay/scope, validates body, rate-limits by user, builds a conservative STAR-aware prompt, calls an injected/OpenAI-compatible provider, validates JSON output, and returns a stable JSON envelope.

**Tech Stack:** Next.js 16 route handlers, Auth.js v5, Drizzle, Node HTTP Agent service, jose JWT, Redis replay/rate-limit primitive, Vitest.

---

## Scope

In scope:
- Add contract documentation/proto draft for `PolishRichText`.
- Add Agent prompt builder and provider abstraction.
- Add Agent `POST /v1/rich-text/polish` JSON route.
- Add Web Agent client method and Web proxy route.
- Add unit/contract tests for auth, validation, STAR prompt rules, provider errors, and request forwarding.

Out of scope:
- No editor button UI.
- No streaming/SSE.
- No assistant-ui.
- No OCR/import resume/AI parsing migration.
- No automatic write-back to React Hook Form.

## Tasks

- [x] Task 1: Add contract docs/proto draft for `PolishRichText`.
- [x] Task 2: Write failing Agent prompt/provider tests.
- [x] Task 3: Implement prompt builder and provider abstraction.
- [x] Task 4: Write failing Agent HTTP route tests.
- [x] Task 5: Implement Agent `POST /v1/rich-text/polish`.
- [x] Task 6: Write failing Web client and route tests.
- [x] Task 7: Implement Web client method and proxy route.
- [x] Task 8: Run targeted tests and full verification gates.

## Validation Commands

- `pnpm --filter @intro-builder/agent test`
- `pnpm test`
- `pnpm tsc --noEmit`
- `pnpm lint`
- `pnpm build`

## Execution Record

- Added `docs/agent/proto/intro_builder_agent_v1.proto` and updated `docs/agent/service-contracts.md` with the Phase 1 HTTP/JSON contract.
- Added Agent `POST /v1/rich-text/polish` with `rich_text:polish` scope, JWT `resumeId` matching, Redis-backed rate limit when configured, STAR-aware prompt construction, OpenAI-compatible provider abstraction, and provider JSON output validation.
- Added Web `POST /api/agent/rich-text/polish` BFF route with Web session check, resume ownership check, short Agent JWT signing, and Agent client forwarding.
- Kept editor UI, assistant-ui, OCR/import resume/AI parsing, streaming, and automatic RHF write-back out of scope.
- Updated Agent deploy workflow so optional `AGENT_MODEL_BASE_URL`, `AGENT_MODEL_API_KEY`, `AGENT_MODEL_NAME`, and `AGENT_MODEL_TIMEOUT_MS` can reach the server without logging secret values.

## Verification Record

- `pnpm --filter @intro-builder/agent test`: passed, 6 files / 35 tests.
- `pnpm test`: passed, Web 58 files / 291 tests plus Agent 6 files / 35 tests.
- `pnpm --filter @intro-builder/agent typecheck`: passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm lint`: passed with existing 10 warnings, 0 errors.
- `pnpm build`: passed; existing `DATABASE_URL` placeholder/template query warnings appeared during static generation.
- `actionlint .github/workflows/deploy-agent.yml`: passed.
