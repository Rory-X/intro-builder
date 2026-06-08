# Agent Service Contracts

本文档定义 Web 主站与 Agent 微服务之间的接口契约。实现前先改这里；代码必须跟这里保持一致。

## Base URL

本地开发：

```bash
http://127.0.0.1:8787
```

部署后由 Caddy 暴露域名和路径前缀。Web 端通过 `AGENT_BASE_URL` 指向该地址：

```bash
https://api.rory-x.me/intro-builder/agent
```

根 `.env.example` 已预留 `AGENT_BASE_URL`。本地开发可以指向 `http://127.0.0.1:8787`，生产环境统一指向上面的公网路径。

Caddy 会剥掉 `/intro-builder/agent` 前缀后再转发给 Agent，所以 Agent 内部仍只需要实现 `/health`、`/ready` 和后续 `/v1/*`。

## 当前已实现 API

### `GET /health`

用途：进程存活检查。

依赖：不依赖 Redis、数据库、模型 provider。

响应头：

```text
X-Request-Id: req_...
```

成功响应：

```json
{
  "status": "ok",
  "service": "intro-agent",
  "version": "0.0.0-dev",
  "uptimeSeconds": 12,
  "timestamp": "2026-06-05T00:00:00.000Z"
}
```

### `GET /ready`

用途：readiness 响应，检查 Redis 可用性。Redis 不可用时返回非 ready 的结构化 JSON。

当前成功响应：

```json
{
  "status": "ready",
  "service": "intro-agent",
  "version": "0.0.0-dev",
  "uptimeSeconds": 12,
  "timestamp": "2026-06-05T00:00:00.000Z",
  "dependencies": {
    "redis": "ready"
  }
}
```

Redis 不可用响应：

HTTP status: `503`

```json
{
  "error": "dependency_unavailable",
  "message": "Redis unavailable: Redis readiness timed out after 1000ms",
  "dependency": "redis",
  "requestId": "req_01H..."
}
```

### `GET /v1/session`

用途：验证 Web 签发的短期 Agent JWT、scope 和 Redis `jti` replay guard。这个接口只用于 Phase 0C smoke，不承载业务 Agent 能力。

认证：`Authorization: Bearer <agent-jwt>`，scope 必须是 `agent:session`。

成功响应：

```json
{
  "status": "ok",
  "subject": "user_123",
  "resumeId": "resume_abc",
  "scope": "agent:session",
  "expiresAt": "2026-06-08T08:02:00.000Z",
  "requestId": "req_01H..."
}
```

缺失 token 响应：

HTTP status: `401`

```json
{
  "error": "unauthorized",
  "message": "Missing bearer token",
  "requestId": "req_01H..."
}
```

scope 不匹配响应：

HTTP status: `403`

```json
{
  "error": "forbidden",
  "message": "Token scope is not allowed for this route",
  "requestId": "req_01H..."
}
```

重放同一 `jti` 响应：

HTTP status: `401`

```json
{
  "error": "unauthorized",
  "message": "Bearer token has already been used",
  "requestId": "req_01H..."
}
```

### Unknown route

```json
{
  "error": "not_found",
  "message": "Route not found",
  "requestId": "req_01H..."
}
```

### Unsupported method

Response status: `405`

Header: `Allow: GET`

```json
{
  "error": "method_not_allowed",
  "message": "Method not allowed",
  "requestId": "req_01H..."
}
```

## Planned API Versioning

业务 API 从 `/v1` 开始。基础健康检查可以保留根路径，但业务能力必须版本化。

Planned endpoints:

| Endpoint | Phase | Purpose |
| --- | --- | --- |
| `GET /v1/session` | Phase 0C | 已实现：验证 Web 签发的 Agent JWT 与 scope |
| `POST /v1/rich-text/polish` | Phase 1 | 富文本局部润色 |
| `POST /v1/resume/helpers/:helperId` | Phase 2 | 简历模块级增量 helper |
| `POST /v1/agent/messages` | Phase 3 | assistant-ui Agent panel 消息入口 |

## Agent JWT Contract

Web 端签发短期 JWT，Agent 端校验。JWT 是用户身份委派，不是长期 session。

Required claims:

| Claim | Example | Meaning |
| --- | --- | --- |
| `iss` | `intro-builder-web` | 签发方 |
| `aud` | `intro-builder-agent` | 接收方 |
| `sub` | `user_123` | 当前用户 id |
| `resumeId` | `resume_abc` | 请求绑定的简历 |
| `scope` | `rich_text:polish` | 允许调用的 Agent 能力 |
| `jti` | `uuid` | 单次 token id，用于 replay guard |
| `iat` | Unix seconds | 签发时间 |
| `exp` | Unix seconds | 过期时间，建议 60 到 180 秒 |

Rules:

- Agent 不信任浏览器 session cookie。
- Agent 不查询 Web session。
- Web 端必须先校验 resume ownership，再签发 Agent JWT。
- Agent 必须校验 `iss`、`aud`、`exp`、`scope`。
- Phase 0C 后，`jti` 已进入 Redis 短期 replay guard，key 为 `auth:jti:{jti}`。

Web smoke endpoint:

```bash
GET /api/agent/session
```

此 Web BFF route 会读取当前 Web session / dev bypass，签发 `agent:session` token，并调用 Agent `GET /v1/session`。它只用于链路 smoke，不授权任何简历级操作。

## Error Envelope

所有业务 API 错误使用统一格式：

```json
{
  "error": "rate_limited",
  "message": "Too many requests",
  "requestId": "req_01H...",
  "retryAfterSeconds": 30
}
```

Error codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | JSON 或字段不合法 |
| `unauthorized` | 401 | 缺少或无法校验 Agent JWT |
| `forbidden` | 403 | scope 不匹配 |
| `not_found` | 404 | route 或资源不存在 |
| `method_not_allowed` | 405 | HTTP 方法不支持 |
| `payload_too_large` | 413 | 输入过大 |
| `rate_limited` | 429 | Redis rate limit 命中 |
| `dependency_unavailable` | 503 | Redis 或 provider 不可用 |
| `provider_timeout` | 504 | 模型 provider 超时 |
| `internal_error` | 500 | 未预期错误 |

## Rich Text Polish Contract

Phase 1 MVP 的目标是“按钮式局部润色”，不是聊天 Agent。运行时第一版使用 HTTP/JSON；protobuf IDL 作为服务契约草案，见 `docs/agent/proto/intro_builder_agent_v1.proto`。

### `POST /v1/rich-text/polish`

认证：`Authorization: Bearer <agent-jwt>`，scope 必须是 `rich_text:polish`。JWT 的 `resumeId` 必须与请求体 `resumeId` 一致。

Request:

```json
{
  "resumeId": "resume_abc",
  "section": "experience",
  "fieldPath": "experience.0.content",
  "locale": "zh-CN",
  "content": {
    "format": "tiptap_json",
    "plainText": "负责业务系统前端开发，优化页面性能。",
    "tiptapJson": {
      "type": "doc",
      "content": []
    }
  },
  "intent": {
    "mode": "polish",
    "tone": "professional",
    "length": "same",
    "strategy": "star"
  }
}
```

Response:

```json
{
  "status": "ok",
  "requestId": "req_01H...",
  "result": {
    "format": "tiptap_json",
    "polishedText": "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
    "replacementTiptapJson": {
      "type": "doc",
      "content": [
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。"
            }
          ]
        }
      ]
    },
    "changeSummary": "按 STAR 思路强化职责与行动表达，未新增结果数据。",
    "riskFlags": [
      {
        "type": "too_little_context",
        "message": "原文缺少可量化结果，已按现有信息保守润色。"
      }
    ]
  },
  "usage": {
    "provider": "openai-compatible",
    "model": "gpt-4.1-mini",
    "inputTokens": 120,
    "outputTokens": 36
  }
}
```

Prompt rules:

- 只润色表达，不新增事实、数字、公司、学校、职位、技术栈、奖项或结果。
- `strategy=star` 时只按 STAR 顺序重排与强化已有信息；原文没有 Result 时不得编造量化结果。
- `content.format=tiptap_json` 时，模型必须返回与原始文本块数量一致的 `polishedBlocks`；Agent 用代码克隆原 TipTap JSON 并生成 `replacementTiptapJson`，不接受模型直接生成任意 TipTap 树。
- 兼容旧 provider：如果响应只有 `plain_text`，Web 端仍只作为候选文本展示，并在用户确认后走纯文本 fallback。
- 模型返回必须是 JSON；Agent 负责解析与后处理校验，校验失败返回结构化错误。

Rules:

- Agent 返回建议内容，不直接写 Postgres。
- Web 端负责用户确认写回 RHF。
- Web 端负责 autosave。
- 用户取消时，Web 必须 abort 请求。
- 失败后不自动覆盖原文。

## Rate Limit Keys

Phase 0B rate limit key format:

```text
rate:{scope}:{userIdHash}:{windowStart}
```

Examples:

```text
rate:rich_text:polish:u_8f1a:202606050930
rate:agent:chat:u_8f1a:202606050930
```

Rules:

- 不同 scope 分开计数。
- user id 使用稳定 hash，不直接在 Redis key 暴露原始 id。
- 超限响应必须包含 `retryAfterSeconds`。
