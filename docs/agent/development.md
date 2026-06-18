# Agent Development Guide

本文档说明如何在本地开发、调试和验证 Agent 微服务。

## Prerequisites

- Node.js 22 for CI and deployment parity.
- pnpm 10.
- Redis for Phase 0B and later.
- Local Docker is optional. Docker smoke currently runs on the Hong Kong server.

## Local Redis

当前本机状态：

```bash
redis-cli ping
# PONG
```

Installed via:

```bash
brew install redis
brew services start redis
```

Connection string:

```bash
redis://127.0.0.1:6379
```

Useful commands:

```bash
brew services list | rg '^redis\s'
brew services restart redis
brew services stop redis
redis-cli INFO server
redis-cli FLUSHDB
```

Use `FLUSHDB` only for local debugging. Never run it against shared or production Redis.

## Agent Commands

From repo root:

```bash
pnpm agent:dev
pnpm agent:test
pnpm agent:typecheck
pnpm agent:build
pnpm agent:start
```

Direct package commands:

```bash
pnpm --filter @intro-builder/agent test
pnpm --filter @intro-builder/agent build
```

## Local Smoke

Build and start the service:

```bash
pnpm agent:build
AGENT_HOST=127.0.0.1 \
  AGENT_PORT=8788 \
  REDIS_URL=redis://127.0.0.1:6379 \
  AGENT_VERSION=smoke-test \
  pnpm agent:start
```

In another shell:

```bash
curl -sS -i http://127.0.0.1:8788/health
curl -sS -i http://127.0.0.1:8788/ready
```

Expected `/health` response status is `200`.
Expected `/ready` response status is `200` when Redis is available and includes:

```json
{
  "dependencies": {
    "redis": "ready"
  }
}
```

To verify Redis-down behavior without stopping local Redis:

```bash
AGENT_HOST=127.0.0.1 \
  AGENT_PORT=8789 \
  REDIS_URL=redis://127.0.0.1:6390 \
  REDIS_CONNECT_TIMEOUT_MS=100 \
  AGENT_VERSION=redis-down-smoke \
  pnpm agent:start

curl -sS -i http://127.0.0.1:8789/health
curl -sS -i -H 'x-request-id: req-smoke-down' http://127.0.0.1:8789/ready
```

Expected result: `/health` returns `200`; `/ready` returns `503 dependency_unavailable` with `requestId` preserved.

## Environment Variables

Current:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_HOST` | `0.0.0.0` | Listen host |
| `AGENT_PORT` | `8787` | Listen port |
| `AGENT_SERVICE_NAME` | `intro-agent` | Service name in health payload |
| `AGENT_VERSION` | `0.0.0-dev` | Version in health payload |
| `AGENT_SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown timeout |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `REDIS_CONNECT_TIMEOUT_MS` | `1000` | Redis connect timeout |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `30` | Per-window limit |
| `AGENT_JWT_ISSUER` | `intro-builder-web` | Expected JWT issuer |
| `AGENT_JWT_AUDIENCE` | `intro-builder-agent` | Expected JWT audience |
| `AGENT_JWT_SECRET` | unset | Shared signing secret; required for protected `/v1/*` routes |
| `AGENT_JWT_REPLAY_TTL_SECONDS` | `180` | Redis `jti` replay guard TTL |
| `AGENT_CORS_ORIGINS` | unset | Comma-separated Web origins allowed to direct-connect to `/v1/agent/messages` |
| `AGENT_ASSISTANT_SURFACE` | `panel` | Web editor Agent entry. Set to `floating` to AB-test the floating assistant; unset keeps the current Agent panel. |

## Phase 0C Auth Smoke

Start Agent with Redis and a local shared secret:

```bash
AGENT_HOST=127.0.0.1 \
  AGENT_PORT=8788 \
  REDIS_URL=redis://127.0.0.1:6379 \
  AGENT_JWT_SECRET=local-agent-secret \
  AGENT_VERSION=auth-smoke \
  pnpm agent:start
```

Start Web with the same secret and an Agent base URL:

```bash
AGENT_BASE_URL=http://127.0.0.1:8788 \
  AGENT_JWT_SECRET=local-agent-secret \
  pnpm dev
```

Then request the Web BFF smoke route while logged in, or with local dev bypass configured:

```bash
curl -sS -i http://127.0.0.1:3000/api/agent/session
```

Expected authenticated result:

```json
{
  "status": "ok",
  "agent": {
    "status": "ok",
    "scope": "agent:session"
  }
}
```

Direct Agent replay guard check:

1. Sign one token with `lib/agent/token.ts`.
2. Reuse the exact same bearer token against `GET /v1/session`.
3. Expected result is `401 unauthorized` with `Bearer token has already been used`.

## Phase 3 Agent Message Contract Smoke

Current implementation status:

- Agent service `POST /v1/agent/messages` exists and requires `agent:chat`.
- Shared Web contract and chat context builders exist.
- Web BFF `/api/agent/messages` exists and validates Auth.js/dev-bypass user plus resume ownership before signing `agent:chat`.
- assistant-ui LocalRuntime seam, thread/composer primitives, left-column Agent panel,
  workflow BFF call, tool card, confirmation card, and editor toolbar `Agent 模式`
  toggle are implemented.

Local contract checks:

```bash
pnpm vitest run tests/unit/agent-chat-context.test.ts
pnpm --filter @intro-builder/agent test -- agent-tools.test.ts agent-messages.test.ts http.test.ts
pnpm agent:typecheck
```

Web BFF slice verification:

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts
```

Agent panel/editor integration verification:

```bash
pnpm vitest run tests/unit/agent-panel.test.tsx tests/unit/editor-client-live-preview.test.tsx
pnpm tsc --noEmit
```

These commands are gates, not historical pass claims. Do not mark future Agent Mode changes ready until they pass in the current worktree and a desktop editor smoke confirms the preview stays visible.

Manual Phase 3 smoke should use this shape:

```text
Editor Agent 模式
  -> POST /api/agent/messages
  -> sign agent:chat JWT after Auth.js and resume ownership checks
  -> POST /v1/agent/messages
  -> return AG-UI text/tool events with proposedOperations
  -> user clicks 应用
  -> Web allowlisted dispatcher calls RHF setValue
  -> dispatch resume:flush-autosave
```

Do not use this smoke to migrate OCR, resume import, or existing AI parsing. Those remain outside the Agent microservice scope.

## Floating Assistant AB Smoke

The floating assistant is gated by Web env, stays in the Next app, and keeps its
own chat sessions:

```bash
PORT=3001 \
  AGENT_ASSISTANT_SURFACE=floating \
  AUTH_DEV_BYPASS=1 \
  AUTH_DEV_USER_ID=dev-user \
  pnpm dev:web
```

Open:

```text
http://localhost:3001/resume/dev-resume-agent-preview/edit?from=dashboard
```

Manual checks:

- The floating bubble opens a compact chat window; the existing Agent panel
  entry is hidden in floating mode.
- The history control loads `/api/agent/floating/sessions?resumeId=...`,
  then `/api/agent/floating/sessions/[sessionId]`; new chat creates a fresh
  `新对话`, and delete removes the active session.
- Sending without a connected model shows `需要先连接模型` locally and does not
  call `/api/agent/floating/chat`.
- After filling model service address, access key, and model name, chat sends
  `sessionId` to `/api/agent/floating/chat`; tool operations returned by the
  route are applied to the editor and flushed through autosave.
- Restart without `AGENT_ASSISTANT_SURFACE=floating` to verify the existing
  Agent Panel fallback still appears.

## Verification Gates

Before claiming an Agent change is ready:

```bash
pnpm agent:test
pnpm agent:typecheck
pnpm agent:build
pnpm verify
```

`pnpm verify` runs:

```bash
pnpm lint
pnpm tsc --noEmit
pnpm test
pnpm build
```

Current known warnings:

- `pnpm lint` has existing Web app warnings unrelated to the Agent package.
- `pnpm build` may print the intentional build-time `DATABASE_URL` placeholder warning when `.env.local` is absent.
- `pnpm build` uses `next build --webpack` for deterministic local and Agent deploy verification. The default Turbopack build path was observed to fail when build-time Google Fonts `.woff2` downloads were reset.
- Phase 3A adds a targeted assistant-ui/tap React 19 webpack compatibility shim in `next.config.ts` and `lib/agent/assistant-ui-react-compat.ts`. It only replaces tap dispatcher's `react` import; remove it if a future assistant-ui/tap version no longer reads the removed React 18 internals export.

## Docker and Caddy

Agent deploy files:

- `apps/agent/Dockerfile`
- `apps/agent/compose.yaml`
- `apps/agent/Caddyfile`
- `apps/agent/.env.example`

The compose stack includes:

- `agent`
- `caddy`
- `redis`

Expected production shape:

```text
internet -> Caddy -> agent:8787
agent -> redis:6379
agent -> model provider
```

Server Docker smoke is recorded in [deployment.md](./deployment.md). Current production-like stack runs at `/opt/intro-agent/apps/agent` on `101.36.117.253`.

The Dockerfile uses a scoped production install in the runner image so runtime dependencies such as `redis` are available without copying the full Web app dependency graph into the Agent image.

## Debugging Checklist

When `/health` fails:

- Check whether the process is running.
- Check `AGENT_PORT` and port conflicts.
- Check recent process logs.

When `/ready` fails after Phase 0B:

- Run `redis-cli ping`.
- Check `REDIS_URL`.
- Check Redis service status with `brew services list`.
- Confirm `/health` still returns `ok`.

When generation endpoints fail after Phase 1:

- Check Agent JWT scope and expiration.
- Check request size.
- Check rate limit response.
- Check provider timeout logs.
- Confirm Web did not write partial output into RHF without user confirmation.
