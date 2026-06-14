# Agent AI SDK And Langfuse Runtime Design

Date: 2026-06-14

## Summary

PR #76 landed the Agent v2 session/workflow foundation: context status, workspace
state, durable session snapshots, typed questions, local preview provider, and a
runtime event adapter. It did not replace the hand-rolled OpenAI-compatible
provider, and it intentionally left Langfuse Prompt Management out of scope.

This design finishes that missing runtime slice. The Agent service should use a
single AI SDK-backed generation adapter for Agent Mode, fetch Agent prompts from
Langfuse Prompt Management when configured, link prompt versions to Langfuse
generation traces, and run Agent contract evals against a Langfuse-hosted
dataset instead of only local JSON cases.

## Goals

1. Replace the Agent Mode hand-written `/chat/completions` fetch and SSE parser
   with a Vercel AI SDK v6 runtime adapter.
2. Preserve the existing Web BFF, AG-UI stream, assistant-ui panel, durable
   session, cache, rate limit and approval boundaries from PR #76.
3. Add Langfuse Prompt Management for the Agent Mode prompt with a local fallback
   and stable production label.
4. Link Langfuse prompt name/version/fallback status into generation traces.
5. Convert the optional Langfuse eval runner to support true
   Langfuse Dataset-backed experiments through `dataset.runExperiment(...)`.
6. Keep secrets server-side. Browser model provider keys and Langfuse keys remain
   out of the client bundle.

## Non-Goals

- Do not migrate rich-text polish or resume helper providers in this slice.
- Do not replace AG-UI or assistant-ui.
- Do not move final resume writes into the Agent service.
- Do not introduce LLM-as-judge quality gates yet.
- Do not require Langfuse credentials for local development or normal tests.

## Runtime Choice

Use Vercel AI SDK v6 for the Agent Mode provider adapter.

Reasons:

- The project already owns the workflow/session runtime. We need a reliable
  generation layer, not another Agent state machine.
- `ai` + `@ai-sdk/openai-compatible` can keep the existing configurable
  OpenAI-compatible provider surface.
- AI SDK exposes OpenTelemetry telemetry and `generateText` / `streamText`,
  which map cleanly to the current `AgentMessageProvider` interface.
- OpenAI Agent SDK remains a good future option for model-native tool loops, but
  adopting it now would force a larger rewrite of the workflow boundary that
  PR #76 just established.

## Architecture

```text
Web BFF /api/agent/runs
  auth, ownership, short Agent JWT, session snapshot

Agent service /v1/agent/messages
  validate request, cache, rate limit
  resolve prompt through Langfuse Prompt Management or local fallback
  run AI SDK provider adapter
  parse existing Agent JSON contract
  emit PR #76 runtime events -> AG-UI SSE
  trace run/generation through Langfuse

Langfuse
  Prompt: intro-builder/agent-message, label production
  Traces: agent.message.run / agent.message.provider
  Dataset: intro-builder/agent-message-contract
  Experiment: dataset.runExperiment with deterministic evaluators
```

## Prompt Management

The Agent prompt remains split into local `system`, `developer`, and `user`
sections. The Langfuse prompt is a chat prompt that may reference these values
with simple Mustache variables:

```text
{{system}}
{{developer}}
{{user}}
```

The local fallback chat prompt is:

```json
[
  { "role": "system", "content": "{{system}}\n\n开发者指令：\n{{developer}}" },
  { "role": "user", "content": "{{user}}" }
]
```

Config:

- `LANGFUSE_PROMPT_MANAGEMENT_ENABLED=true`
- `LANGFUSE_AGENT_MESSAGE_PROMPT_NAME=intro-builder/agent-message`
- `LANGFUSE_PROMPT_LABEL=production`
- `LANGFUSE_PROMPT_CACHE_TTL_SECONDS=300`
- `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS=5000`

If prompt management is disabled or credentials are missing, the Agent uses the
local prompt. If Langfuse retrieval fails, Langfuse SDK fallback content is used
and the trace records `isFallback=true`.

## AI SDK Provider Adapter

The production adapter creates an OpenAI-compatible AI SDK model from:

- `AGENT_MODEL_BASE_URL`
- `AGENT_MODEL_API_KEY`
- `AGENT_MODEL_NAME`

Request-scoped BYOK model config keeps using the existing validated
`modelConfig` path and is still only sent to the Agent service by Web BFF.

The adapter maps current prompt messages to `generateText` and `streamText` with
JSON output enabled, then returns the same `AgentMessageProviderRunResult` and
`AgentProviderStreamChunk` shape as before. The downstream parser, runtime event
adapter, AG-UI stream, cache and UI do not change.

AI SDK telemetry is enabled with `recordInputs=false` and `recordOutputs=false`
unless raw Langfuse payload capture is explicitly enabled.

## Langfuse Dataset Evals

The existing local JSON cases remain useful for offline CI. The Langfuse command
adds a dataset-backed path:

- dataset name comes from `LANGFUSE_AGENT_MESSAGE_DATASET_NAME`;
- dataset items use `input.caseId`, `input.description`, `input.modelOutput`;
- `expectedOutput` uses the existing deterministic expectation shape;
- task returns `modelOutput`;
- evaluators reuse the production parser/validator scoring code;
- run evaluator emits aggregate pass rate.

When credentials are missing, the command skips as today. When credentials exist
but the dataset name is missing, the command fails with a clear message instead
of silently running a local-only experiment.

## Privacy And Security

- Provider keys remain in Agent service config or request-scoped server payloads.
- Langfuse keys remain server-side.
- Default traces capture metadata and prompt lengths, not raw resume text.
- Raw prompt/output capture continues to require
  `LANGFUSE_CAPTURE_RAW_PAYLOADS=true`.
- The browser never receives Langfuse prompt names, versions, API keys, or model
  provider internals in the normal Agent panel.

## Done

- Agent Mode production provider is created by the AI SDK adapter.
- Agent Mode no longer contains a hand-written OpenAI-compatible SSE parser.
- Prompt resolution can fetch Langfuse chat prompts with local fallback.
- Generation traces include prompt metadata when Langfuse prompt management is
  used.
- Langfuse eval command can run against a hosted dataset via
  `dataset.runExperiment(...)`.
- Focused agent tests and typecheck pass.
