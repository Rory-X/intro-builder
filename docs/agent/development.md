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
