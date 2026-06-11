# Agent Langfuse Observability And Evals

## Why

Agent Mode is now a human-in-the-loop proposal system: the model returns a
structured message, synthetic tool calls, and proposed resume operations; the UI
turns operations into approval interrupts and only applies changes after the user
confirms them. Recent bugs around tool status and interrupt classification were
state-machine bugs, and plain server logs did not show enough of the run
lifecycle to diagnose them quickly.

Langfuse should become the project-owned observability and evaluation layer for
this agent surface. The goal is not to replace AG-UI, assistant-ui, or the
typed output contract. The goal is to make each agent run inspectable and make
agent quality measurable in CI and, when configured, in Langfuse.

## What

Implement two layers.

### Layer 1: Observability

- Add an agent-service Langfuse configuration block that is disabled by default
  and becomes active only when credentials are present and tracing is enabled.
- Add a small project-owned observability adapter so app code depends on
  Intro Builder semantics, not Langfuse SDK calls directly.
- Trace `/v1/agent/messages` runs with:
  - request id
  - workflow id
  - service name and version
  - environment
  - model name
  - hashed user id
  - resume id only as metadata, not as trace input
  - section count and message count
  - cache hit or miss
  - parse success or parse failure
  - tool call count
  - proposed operation count
  - interrupt reason summary
  - provider usage tokens when available
- Do not record raw resume text, raw user messages, or raw model output by
  default. A separate explicit env flag may enable raw payload capture for local
  debugging.
- Do not make Langfuse required for local development, tests, or CI. Missing
  keys must produce a no-op observer.
- Flush tracing during agent service shutdown.

### Layer 2: Evals

- Add a deterministic offline eval suite for the Agent Mode structured output
  contract. It must run without Langfuse credentials and without a live model.
- The offline suite should evaluate fixture model outputs against the same
  parser and validator used by production code.
- Scores must cover:
  - valid JSON
  - valid tool/output contract
  - expected operation count
  - expected risk flag presence
  - forbidden fabrication tokens
  - required field paths
- Add an optional Langfuse experiment runner. When credentials are present, the
  same dataset and deterministic evaluators should be runnable through
  `LangfuseClient.experiment.run`.
- The eval command should fail non-zero when any required score fails.

## Privacy Rules

- Default tracing is metadata-only.
- Raw prompt, raw resume content, raw model output, and user free text are
  excluded unless `LANGFUSE_CAPTURE_RAW_PAYLOADS=true`.
- User identifiers are hashed before being sent to Langfuse.
- Fixture eval data must be synthetic or anonymized.

## Out Of Scope

- Replacing the agent loop with LangChain or LangGraph.
- Adding Langfuse prompt management.
- Running LLM-as-judge evals.
- Tracing every non-Agent AI helper in the first cut. The adapter should make
  that easy later.

## Done

- Agent service has Langfuse env config and no-op behavior without credentials.
- `/v1/agent/messages` creates meaningful Langfuse observations when enabled.
- Offline eval fixtures and command are committed and covered by tests.
- Optional Langfuse experiment runner is wired to the same evaluator logic.
- `pnpm --filter @intro-builder/agent test` covers config, tracing adapter, and
  eval scoring behavior.
- Root verification gates still pass before this work is called complete.
