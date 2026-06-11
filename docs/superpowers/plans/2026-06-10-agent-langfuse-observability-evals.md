# Agent Langfuse Observability And Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Langfuse a first-class, privacy-aware observability and deterministic evaluation layer for Agent Mode.

**Architecture:** Add a small `apps/agent/src/observability.ts` adapter that hides Langfuse SDK details behind project-owned methods. Add a deterministic eval runner under `apps/agent/src/evals/` that can run offline in CI and optionally through `LangfuseClient.experiment.run` when credentials exist.

**Tech Stack:** TypeScript, Vitest, `@langfuse/tracing`, `@langfuse/client`, `@langfuse/otel`, OpenTelemetry, existing Agent Mode parser/validator.

---

### Task 1: Configuration And Dependency Surface

**Files:**
- Modify: `apps/agent/package.json`
- Modify: `apps/agent/src/config.ts`
- Modify: `apps/agent/tests/config.test.ts`
- Modify: `apps/agent/.env.example`

- [x] Add Langfuse SDK and OpenTelemetry dependencies to the agent package.
- [x] Add config fields for enablement, credentials, base URL, environment, release, timeout, sampling, and raw payload capture.
- [x] Add config tests proving empty env is no-op and explicit env is parsed.
- [x] Update `.env.example` with commented Langfuse settings.

### Task 2: Observability Adapter

**Files:**
- Create: `apps/agent/src/observability.ts`
- Create: `apps/agent/tests/observability.test.ts`
- Modify: `apps/agent/src/index.ts`

- [x] Write failing tests for no-op behavior without credentials.
- [x] Write failing tests for metadata sanitization and hashed user ids.
- [x] Implement `createAgentObservability(config)` with no-op and Langfuse-backed variants.
- [x] Initialize Langfuse/OpenTelemetry only when enabled.
- [x] Flush/shutdown observability during service shutdown.

### Task 3: Agent Message Tracing

**Files:**
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/tests/http.test.ts`
- Modify: `apps/agent/src/agent-messages.ts` if provider-level tracing needs a narrow hook.

- [x] Add tests that `/v1/agent/messages` records cache hit, parse success, parse failure, operation counts, and usage metadata through an injected observer.
- [x] Thread observability through `createAgentServer`.
- [x] Wrap the non-streaming Agent Mode provider path in agent-run and generation observations.
- [x] Add equivalent high-level tracing for the streaming path without buffering raw SSE output.

### Task 4: Deterministic Offline Evals

**Files:**
- Create: `apps/agent/evals/agent-message-contract-cases.json`
- Create: `apps/agent/src/evals/agent-message-contract-eval.ts`
- Create: `apps/agent/tests/agent-message-contract-eval.test.ts`
- Modify: `apps/agent/package.json`

- [x] Add synthetic eval fixtures for valid suggestions, missing-fact risk flags, invalid JSON, invalid field paths, and fabrication tokens.
- [x] Implement scorer functions that reuse `parseAgentMessageProviderResponse`.
- [x] Add `pnpm --filter @intro-builder/agent eval:agent:offline`.
- [x] Make the offline command exit non-zero on any required failure.

### Task 5: Optional Langfuse Experiment Runner

**Files:**
- Create: `apps/agent/src/evals/langfuse-agent-message-experiment.ts`
- Create: `apps/agent/tests/langfuse-agent-message-experiment.test.ts`
- Modify: `apps/agent/package.json`

- [x] Write tests with a fake Langfuse client proving the same offline cases become Langfuse experiment items and scores.
- [x] Implement `runLangfuseAgentMessageExperiment` using `LangfuseClient.experiment.run`.
- [x] Add `pnpm --filter @intro-builder/agent eval:agent:langfuse` that skips with a clear message when credentials are absent.

### Task 6: Verification

**Files:**
- No production files expected unless tests expose gaps.

- [x] Run focused agent tests.
- [x] Run `pnpm --filter @intro-builder/agent eval:agent:offline`.
- [x] Run `pnpm test`.
- [x] Run `pnpm tsc --noEmit`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.

## Self-Review

- The plan covers both requested layers: observability and evals.
- The plan preserves the existing AG-UI and typed output architecture.
- The default path is privacy-safe and CI-safe because Langfuse is no-op without credentials.
- The eval path is meaningful without live model access because it validates production parser/validator behavior against fixtures.
