# Agent AI SDK And Langfuse Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the PR #76 follow-up runtime slice by replacing Agent Mode provider calls with AI SDK and adding Langfuse prompt/dataset eval integration.

**Architecture:** Keep the PR #76 Web BFF, AG-UI, assistant-ui, durable session, workflow runtime and apply boundary intact. Add a small Agent-service AI SDK provider adapter, an Agent prompt resolver that optionally reads Langfuse Prompt Management, and a dataset-backed Langfuse experiment runner.

**Tech Stack:** TypeScript, Vitest, Vercel AI SDK v6, `@ai-sdk/openai-compatible`, Langfuse JS SDK v5, OpenTelemetry, existing Agent service.

---

## File Structure

- Create `apps/agent/src/providers/ai-sdk-agent-message-provider.ts` for the unified Agent Mode provider adapter.
- Create `apps/agent/src/prompts/agent-message-prompt-resolver.ts` for local/Langfuse prompt resolution.
- Modify `apps/agent/src/agent-messages.ts` to support compiled prompt messages and remove the hand-written Agent Mode provider fetch/SSE parser.
- Modify `apps/agent/src/http.ts` and `apps/agent/src/index.ts` to use the new resolver/provider.
- Modify `apps/agent/src/config.ts` and tests for prompt/dataset env.
- Modify `apps/agent/src/observability.ts` to attach prompt metadata to Langfuse generation observations.
- Modify `apps/agent/src/evals/langfuse-agent-message-experiment.ts` and runner script for dataset-backed experiments.
- Update `docs/agent/observability-and-evals.md` and `docs/agent/README.md`.

## Task 1: Config And Dependencies

**Files:**
- Modify: `apps/agent/package.json`
- Modify: `apps/agent/src/config.ts`
- Modify: `apps/agent/tests/config.test.ts`

- [x] Add `ai`, `@ai-sdk/openai-compatible`, and explicit `zod` dependency to the Agent package.
- [x] Add Langfuse prompt management config fields.
- [x] Add Langfuse Agent message dataset config fields.
- [x] Run `pnpm --filter @intro-builder/agent test -- tests/config.test.ts`.

## Task 2: AI SDK Provider Adapter

**Files:**
- Create: `apps/agent/src/providers/ai-sdk-agent-message-provider.ts`
- Create: `apps/agent/tests/ai-sdk-agent-message-provider.test.ts`
- Modify: `apps/agent/src/agent-messages.ts`
- Modify: `apps/agent/src/index.ts`
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/tests/agent-messages.test.ts`

- [x] Write tests proving the adapter calls an injected AI SDK runtime for both `run` and `stream`.
- [x] Verify it emits the existing provider result shape and usage shape.
- [x] Wire production runtime through `generateText` / `streamText` and `createOpenAICompatible`.
- [x] Remove the Agent Mode hand-written OpenAI-compatible streaming parser.
- [x] Run focused provider and Agent message tests.

## Task 3: Langfuse Prompt Resolver

**Files:**
- Create: `apps/agent/src/prompts/agent-message-prompt-resolver.ts`
- Create: `apps/agent/tests/agent-message-prompt-resolver.test.ts`
- Modify: `apps/agent/src/http.ts`

- [x] Write tests for local fallback, Langfuse chat prompt compilation, and disabled/missing-credentials behavior.
- [x] Implement resolver with `langfuse.prompt.get(..., { type: "chat", label: "production", fallback })`.
- [x] Use compiled prompt messages in the AI SDK provider while preserving local prompt fields for parser/eval tests.
- [x] Run focused prompt resolver tests.

## Task 4: Trace Prompt Metadata

**Files:**
- Modify: `apps/agent/src/observability.ts`
- Modify: `apps/agent/tests/observability.test.ts`

- [x] Add tests that generation trace metadata contains prompt source/name/label/version/fallback status without raw payloads.
- [x] Attach Langfuse prompt metadata to `agent.message.provider` generation observations.
- [x] Keep input/output recording gated by `LANGFUSE_CAPTURE_RAW_PAYLOADS`.

## Task 5: Langfuse Dataset Experiment Runner

**Files:**
- Modify: `apps/agent/src/evals/langfuse-agent-message-experiment.ts`
- Modify: `apps/agent/src/evals/run-langfuse-agent-message-experiment.ts`
- Modify: `apps/agent/tests/langfuse-agent-message-experiment.test.ts`

- [x] Write tests for dataset-backed `dataset.get(...).runExperiment(...)`.
- [x] Reuse existing deterministic evaluator logic for dataset items.
- [x] Make the CLI require `LANGFUSE_AGENT_MESSAGE_DATASET_NAME` when credentials exist.
- [x] Preserve no-credentials skip behavior.

## Task 6: Docs And Verification

**Files:**
- Modify: `docs/agent/README.md`
- Modify: `docs/agent/observability-and-evals.md`
- Modify: `docs/superpowers/plans/2026-06-14-agent-ai-sdk-langfuse-runtime.md`

- [x] Mark completed plan tasks as they land.
- [x] Run `pnpm --filter @intro-builder/agent test`.
- [x] Run `pnpm --filter @intro-builder/agent typecheck`.
- [x] Run `pnpm --filter @intro-builder/agent eval:agent:offline`.
- [x] Run repository gates: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- [x] Report that this is PR #76's follow-up runtime slice.
