# Agent Security and Session Boundary Design

Date: 2026-06-13

## Summary

This slice hardens the current Agent Mode before replacing the runtime with a
more agentic AI SDK executor. The goal is to keep the assistant-ui / AG-UI
conversation flow while fixing the risky edges exposed by the JadeAI review:
browser-provided model keys, custom provider URLs, create-from-zero durable
session identity, and long streaming runs.

The implementation keeps the existing product boundary:

- Browser and Web BFF may pass a request-scoped API key to the Agent service.
- Web and Agent must not persist the key in databases, event logs, cache keys,
  Langfuse metadata, or server logs.
- Agent may call the configured model provider, but only after validating that
  the provider URL is safe.
- Agent proposes changes through workspace/change-set events; Web applies
  confirmed changes to RHF and autosave.

## Problem

The current Agent v2 work has three launch-blocking risks.

1. The model settings dialog persists API keys in `localStorage`, which is too
   durable and too easy for same-origin scripts or extensions to read.
2. A user-supplied `modelConfig.baseUrl` can make the Agent service perform a
   server-side fetch to arbitrary URLs.
3. Create-from-zero sessions use a fixed global session id, so concurrent users
   and concurrent tabs can overwrite or read the wrong durable workspace state.

There is also a product reliability issue: Web's Agent client keeps a single
stream timeout active until the whole response ends, so long but healthy
streaming runs can be aborted.

## Goals

- Make BYOK request-scoped by default.
- Remove API key persistence from `localStorage`.
- Keep API keys out of server persistence and observability.
- Reject unsafe custom model endpoints before any provider fetch occurs.
- Make create-from-zero sessions unique per user and AG-UI thread.
- Preserve the simple Agent panel UI and hide internal provider/tool names.
- Allow long streaming runs as long as data continues to arrive.

## Non-Goals

- Do not store encrypted API keys on the server in this PR.
- Do not replace the runtime with Vercel AI SDK or OpenAI Agent SDK in this PR.
- Do not allow Agent service to directly mutate final resume records.
- Do not redesign the whole Agent panel UI.

## Design

### BYOK Storage

The model settings dialog will keep provider settings in browser state during
the active tab session. API keys should use `sessionStorage` as the maximum
default persistence scope. Base URL and model name may remain locally
persistent because they are not secrets, but the API key must not be written to
`localStorage`.

On page load, the dialog may hydrate the API key from `sessionStorage`. Closing
the browser tab clears it. A later encrypted "remember key" feature can be
added with a separate design.

### Provider URL Guard

The Agent service will validate request-scoped `modelConfig.baseUrl` before
creating a provider. The guard must reject:

- non-HTTP(S) schemes,
- plain HTTP except loopback in development tests only if explicitly allowed,
- localhost and loopback hosts,
- private IPv4 ranges,
- link-local and metadata hosts,
- invalid URLs.

The first implementation can block obvious hostnames and literal IP ranges. DNS
rebind protection should be added before production BYOK custom endpoints if
arbitrary domains remain allowed. The safer long-term shape is a provider
registry with user-facing provider labels and per-provider endpoint policies.

### Durable Session Identity

Web owns Agent session identity. For existing resume sessions, a deterministic
session id per resume remains acceptable. For create-from-zero, the session id
must include the user id and AG-UI thread id:

```text
agent_session_create_from_zero_<hash(userId)>_<threadId>
```

The thread id must come from assistant-ui / AG-UI input, not a global constant.
This makes two tabs independent and prevents cross-user state collisions. The
stored snapshot still contains only `userIdHash`, not raw user id.

### Streaming Timeout

The Web Agent client should clear the initial connection timeout once a stream
response has been received and then enforce an idle timeout while reading
chunks. A healthy long run that emits chunks should not be aborted simply
because total wall-clock time exceeds `AGENT_STREAM_TIMEOUT_MS`.

## Success Criteria

- Tests prove API keys are no longer stored in `localStorage`.
- Tests prove unsafe provider URLs are rejected before `fetch`.
- Tests prove create-from-zero session ids differ by user and thread.
- Tests prove a long streaming response can continue beyond the initial JSON
  timeout while still cleaning up timers.
- Existing Agent panel flow and focused Agent tests remain green.
