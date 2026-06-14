# Agent Direct Data Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Agent Mode's long AG-UI SSE data plane from the Web BFF to the self-hosted Agent service while keeping BFF control-plane authority.

**Architecture:** Add a short Web bootstrap route that validates auth/resume ownership, signs a one-run Agent JWT, and returns a direct Agent stream URL plus session context. Update the browser AG-UI runtime to prefer the direct Agent stream and fall back to the existing BFF stream. Add Agent-service CORS and Redis-backed session event persistence so durable state is written by the long-running Agent process.

**Tech Stack:** Next.js App Router route handlers, AG-UI, assistant-ui, Node HTTP Agent service, Redis, Vitest.

---

## File Structure

- Create `apps/web/app/api/agent/direct-runs/route.ts` for the short control-plane bootstrap.
- Create `apps/web/tests/unit/agent-direct-runs-route.test.ts` for BFF auth, ownership, token, URL, and session-context behavior.
- Modify `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx` so the custom `HttpAgent` prefers direct stream fetch and falls back to `/api/agent/runs`.
- Modify `packages/shared/src/types/agent.ts` and `apps/agent/src/agent-messages.ts` to add `sessionContext`.
- Create `apps/agent/src/session-store.ts` for Redis-backed Agent session snapshots and event logs.
- Modify `apps/agent/src/http.ts` for CORS, session snapshot loading, and stream-event persistence.
- Modify `apps/agent/src/config.ts`, `apps/agent/tests/config.test.ts`, and `.env.example` files for direct/CORS env.
- Modify `apps/agent/tests/http.test.ts` for CORS and Agent-side persistence coverage.

## Task 1: Bootstrap Route Tests

- [x] Add tests proving `/api/agent/direct-runs` rejects unauthenticated users, validates resume ownership, signs `agent:chat`, computes existing-resume session context, and returns the configured direct stream URL.
- [x] Add tests proving create-from-zero bootstrap does not query a resume row and produces user/thread-isolated session ids.
- [x] Run focused tests and verify the new route/client tests failed before implementation.

## Task 2: Bootstrap Route Implementation

- [x] Implement `apps/web/app/api/agent/direct-runs/route.ts` using the existing AG-UI run adapter and token signer.
- [x] Add a small helper for public Agent base URL resolution with local default `http://127.0.0.1:8787` and production override `AGENT_PUBLIC_BASE_URL`.
- [x] Run focused Web tests and mark Task 1/2 complete.

## Task 3: Browser Direct Stream Tests And Runtime

- [x] Add focused tests or component-level coverage for direct bootstrap/fetch fallback where practical.
- [x] Update `IntroBuilderHttpAgent` to bootstrap direct streams before calling `super.runAgent`.
- [x] Keep the response observer unchanged so context status, workspace, tool result, interrupts and errors keep flowing through existing UI callbacks.

## Task 4: Agent CORS And Session Context Tests

- [x] Add Agent tests for allowed preflight on `/v1/agent/messages` and no wildcard origin on authorized direct calls.
- [x] Add validation tests that `sessionContext.resumeId` must match both JWT and request.
- [x] Run focused Agent tests and verify they fail before implementation.

## Task 5: Agent-Side Session Store

- [x] Implement Redis session store with latest snapshot load/save and append-only event log.
- [x] Inject the store into `createAgentServer`.
- [x] Persist emitted AG-UI events from streaming and cached SSE responses without `tee()`.
- [x] Load snapshot before prompt/workflow execution when `sessionContext` is present.

## Task 6: Docs, Env, And Verification

- [x] Update `.env.example`, `apps/web/.env.example`, `apps/agent/.env.example`, and Agent docs with `AGENT_PUBLIC_BASE_URL` and `AGENT_CORS_ORIGINS`.
- [x] Run `pnpm test`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [ ] Push the PR branch after verification.
