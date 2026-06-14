# Agent Direct Data Plane Design

Date: 2026-06-14

## Summary

PR #76 already gives Agent Mode a v2 workflow runtime, AG-UI stream, assistant-ui
panel, long context status, Langfuse runtime support, and durable session
snapshots. The remaining architectural problem is where the long stream lives.

The current Web BFF `/api/agent/runs` keeps the browser connected to a Vercel
route, then `tee()`s the Agent stream and persists events in a background task.
That still puts the longest loop on a serverless request and makes persistence
depend on background work after the response starts. This design moves the long
data plane to the self-hosted Agent service while keeping the Web BFF as the
control plane.

## Goals

1. Keep Web BFF authoritative for login, resume ownership, scoped Agent JWT
   issuance, session identity, and final confirmed resume writes.
2. Let the browser connect directly to the self-hosted Agent service for
   `/v1/agent/messages` AG-UI SSE streams.
3. Add browser-safe CORS support to the Agent service for the direct stream
   endpoint.
4. Move Agent session event persistence into the Agent service so event-log
   writes are part of the long-running service path, not Vercel background work.
5. Keep `/api/agent/runs` as a legacy fallback path during this migration.

## Non-Goals

- Do not put `AGENT_JWT_SECRET`, Langfuse secrets, or server model provider keys
  in the browser.
- Do not move final resume writes into the Agent service.
- Do not replace AG-UI, assistant-ui, the workflow runtime, or Langfuse tracing.
- Do not require the browser to know provider names, tool names, or low-level
  runtime settings.

## Architecture

```text
Browser Agent panel
  POST /api/agent/direct-runs
    -> short BFF control-plane request
    -> returns streamUrl, one-run JWT, expiresAt, Agent request payload

Browser Agent panel
  POST {streamUrl} Accept: text/event-stream
    Authorization: Bearer {one-run JWT}
    body: AgentMessageRequest + sessionContext
    -> long AG-UI SSE direct to self-hosted Agent

Agent service
  CORS allow configured Web origins
  validate JWT scope and resume binding
  load Agent-owned session snapshot from Redis
  run provider/workflow/runtime
  emit AG-UI SSE
  persist emitted events and latest snapshot to Redis
```

The BFF still signs a short `agent:chat` JWT and computes the session identity:

- existing resume: `agent_session_<resumeId>` and `threadId=<AG-UI threadId>`;
- create-from-zero: `agent_session_create_from_zero_<userHash>_<threadId>`.

The Agent service validates that `sessionContext.resumeId` matches the JWT and
request. It then loads a snapshot from its own Redis-backed session store and
injects it into the request before prompt/workflow execution.

## Web Control Plane

Add `POST /api/agent/direct-runs`.

Input is the same AG-UI `RunAgentInput` as `/api/agent/runs`. The route:

1. authenticates the Web user;
2. maps AG-UI input to `AgentMessageRequest`;
3. validates resume ownership for existing resumes;
4. computes `sessionContext`;
5. signs a short `agent:chat` token;
6. returns the direct Agent stream URL and sanitized Agent request payload.

The response never includes signing secrets. BYOK model settings continue to
come from the current client-side settings flow and are sent only inside the
one-run Agent request.

## Browser Data Plane

`AgentAgUiRuntimeProvider` should prefer the direct path:

1. submit the AG-UI run to `/api/agent/direct-runs`;
2. if direct bootstrap succeeds, `fetch(streamUrl, ...)` with the returned JWT;
3. pass the resulting SSE `Response` back through the same AG-UI observer and
   assistant-ui runtime code;
4. if bootstrap is disabled or direct fetch fails before a stream starts, fall
   back to `/api/agent/runs`.

The UI remains simple. Errors shown to users stay generic and Chinese; internal
agent route names, provider keys, and tool identifiers stay hidden.

## Agent Session Store

Agent-owned session state uses Redis because the Agent service already requires
Redis for readiness, replay guard, rate limit, and cache. The store keeps:

- `agent:session:<sessionId>:snapshot` as the latest JSON snapshot;
- `agent:session:<sessionId>:events` as an append-only JSON list of emitted
  AG-UI events.

Persistence is best-effort but in-process with the stream. A failed session
write should log and continue the stream, but it should no longer depend on
Vercel `after()` or a second `tee()` branch.

## Security

- Browser receives only a scoped, short-lived, single-use Agent JWT.
- `AGENT_JWT_SECRET` remains only in Web server and Agent service env.
- Agent CORS allows configured Web origins and supports credentials-free bearer
  requests. It does not use wildcard origins for authorized browser calls.
- Create-from-zero requests use an unscoped-resume JWT but still bind to the
  authenticated Web user through `sub` and session id hashing.
- Existing resume requests require JWT `resumeId`, request `resumeId`, and
  `sessionContext.resumeId` to match.

## Done

- Direct bootstrap route returns stream URL, token metadata, Agent request, and
  session context after BFF auth and ownership checks.
- Agent panel uses direct SSE first and legacy BFF streaming as fallback.
- Agent service handles CORS preflight and CORS response headers for direct
  browser calls.
- Agent service loads/saves Agent session snapshots and events from its own
  Redis store.
- Focused tests cover bootstrap, CORS, direct session persistence, and fallback
  behavior.
