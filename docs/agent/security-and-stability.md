# Security and Stability Checklist

本文档是 Agent 微服务上线前的安全与稳定性检查清单。每个新 Agent 能力都要对照这里。

## Trust Boundaries

| Boundary | Rule |
| --- | --- |
| Browser -> Web | 使用现有 Auth.js session |
| Web -> Agent | 使用短期 Agent JWT 或 Web BFF 内部凭证 |
| Agent -> Redis | 使用 `REDIS_URL`，只存短期状态 |
| Agent -> Provider | provider key 只存在 Agent server env |
| Agent -> Postgres | 默认禁止直接连接 |

## Authentication

Required before business APIs:

- Web 端验证用户已登录。
- Web 端验证 resume ownership。
- Web 端签发短期 Agent JWT。
- Agent 校验 `iss`、`aud`、`sub`、`scope`、`exp`。
- Agent 校验 `jti`，并用 Redis 做短期 replay guard。

Verification:

- Missing token returns `401 unauthorized`。
- Expired token returns `401 unauthorized`。
- Wrong scope returns `403 forbidden`。
- Replayed `jti` returns `401 unauthorized` or `403 forbidden`，具体 code 在 service contract 中固定。

## Authorization Scopes

Initial scopes:

| Scope | Phase | Meaning |
| --- | --- | --- |
| `agent:session` | 0C | 验证调用链 |
| `rich_text:polish` | 1 | 富文本局部润色 |
| `resume:helper` | 2 | 简历模块 helper |
| `agent:chat` | 3 | assistant-ui panel |

Rules:

- 每个 route 只接受自己的 scope。
- scope 进入 rate limit key。
- scope 不等价于用户权限；用户权限仍由 Web 校验。

## Input Limits

Required limits:

- JSON body size limit。
- TipTap JSON node count limit。
- Plain text extracted length limit。
- Max stream duration。
- Max provider output tokens。

Recommended starting values:

| Limit | Starting value |
| --- | --- |
| JSON body | 128 KB |
| Rich text plain text | 4,000 chars |
| Resume helper context | 12,000 chars |
| Stream duration | 45 seconds |
| Provider output | 1,000 tokens |

These are starting points. Tune after observing real usage.

## Rate Limits

Redis-backed rate limit is required before exposing model calls.

Initial keys:

```text
rate:{scope}:{userIdHash}:{windowStart}
```

Rules:

- Rate limit by user and scope。
- Include `retryAfterSeconds` on `429`。
- Do not retry provider calls after rate limit failure。
- Free/paid tiers belong to Phase 4, but the primitive should support config overrides.

## Timeouts

Recommended timeouts:

| Layer | Timeout |
| --- | --- |
| Web -> Agent connect | 2 seconds |
| Web -> Agent total non-stream | 10 seconds |
| Rich text polish stream | 45 seconds |
| Provider first token | 15 seconds |
| Redis connect | 1 second |
| Redis command | 500 ms |

Rules:

- Browser cancellation must abort Web request。
- Web cancellation must abort Agent request。
- Agent cancellation must abort provider stream when supported。

## Retry Policy

Allowed retry:

- `GET /health`
- `GET /ready`
- future read-only metadata endpoints
- Redis reconnect at client level

Not allowed by default:

- `POST /v1/rich-text/polish`
- `POST /v1/agent/messages`
- any request that may consume provider tokens

Why:

Model generation is not safely idempotent. Automatic retries can double-charge tokens and produce conflicting suggestions.

## Error Handling

Rules:

- Every error response is JSON。
- Provider raw error text is not shown to users。
- Logs include provider error class and request id。
- Web maps errors to Chinese UI messages。
- Rate limit and timeout errors should give a next action。

Required codes:

- `bad_request`
- `unauthorized`
- `forbidden`
- `payload_too_large`
- `rate_limited`
- `dependency_unavailable`
- `provider_timeout`
- `internal_error`

## Observability

Every Agent request log should include:

- `requestId`
- `route`
- `method`
- `status`
- `durationMs`
- `scope`
- `userHash`
- `resumeIdHash`
- `provider`
- `errorCode`

Do not log:

- raw resume content
- provider API key
- JWT token
- full user email
- full user id if not needed

## Readiness and Health

`/health`:

- Checks process only。
- Should return ok while Redis is down。
- Used by process supervisors to know the service is alive。

`/ready`:

- Checks Redis。
- May later check required config。
- Returns non-ready JSON when dependencies are down。

## Deployment Safety

Before deploying:

- `pnpm verify` passes。
- `pnpm agent:build` passes。
- `docker build -f apps/agent/Dockerfile .` passes in an environment with Docker。
- `/health` returns `200`。
- `/ready` returns ready with Redis running。
- Redis has persistence policy decided。
- Caddy has TLS/domain configured。
- GitHub Actions deployment uses a restricted deploy user, not `root`。
- Public DNS/TLS is verified from outside the server, not only with Caddy local `--resolve` smoke。

Rollback rule:

- Agent rollout must not require Web app rollback for editor basics to function。
- Web should degrade Agent UI when Agent is unavailable。

## Frontend Safety

Rules:

- Agent suggestions require user confirmation。
- Do not write partial stream chunks into RHF。
- Do not call `saveResume` directly from Agent UI components。
- After confirmed writeback, use existing RHF callbacks and autosave flush。
- assistant-ui panel state must not become resume content。

Verification:

- Cancel before final chunk leaves original content unchanged。
- Apply suggestion updates preview。
- Apply suggestion triggers autosave。
- Agent unavailable does not break typing in editor。

## Production Red Flags

Stop and redesign if any of these appear:

- Browser receives provider key。
- Agent writes directly to Postgres。
- assistant-ui imported into the editor main bundle before Phase 3。
- Redis stores full resume documents without TTL。
- Automatic retry wraps provider generation calls。
- `/health` fails when Redis is down。
- Error toast shows raw provider stack traces。
