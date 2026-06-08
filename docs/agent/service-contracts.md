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

## Resume Helper Contract

Phase 2A 增加结构化简历 helper 建议。它不是聊天界面，也不写入简历内容。

### `POST /v1/resume/helpers/:helperId`

Supported helper IDs:

| Helper ID | Meaning |
| --- | --- |
| `resume-diagnose` | Diagnose whole-resume gaps and next edits |
| `section-next-steps` | Suggest next edits for one section |

认证：`Authorization: Bearer <agent-jwt>`，scope 必须是 `resume:helper`。JWT 的 `resumeId` 必须与请求体 `resumeId` 一致。

Request:

```json
{
  "resumeId": "resume_abc",
  "locale": "zh-CN",
  "target": {
    "kind": "resume",
    "section": null,
    "fieldPath": null
  },
  "context": {
    "resumeTitle": "前端开发工程师",
    "completeness": {
      "overall": 68,
      "sections": [
        { "key": "experience", "label": "工作经历", "score": 7, "max": 10 }
      ]
    },
    "sections": [
      {
        "key": "experience",
        "label": "工作经历",
        "plainText": "负责业务系统前端开发，优化页面性能。"
      }
    ]
  },
  "intent": {
    "mode": "diagnose",
    "maxSuggestions": 5,
    "strategy": "star"
  }
}
```

Response:

```json
{
  "status": "ok",
  "requestId": "req_01H...",
  "helperId": "resume-diagnose",
  "result": {
    "summary": "整体内容完整，但工作经历缺少可验证结果。",
    "suggestions": [
      {
        "id": "sug_experience_result",
        "section": "experience",
        "fieldPath": "experience",
        "severity": "high",
        "title": "为工作经历补充可验证结果",
        "rationale": "当前经历描述了动作，但没有说明产出或影响。",
        "actionLabel": "补充结果",
        "example": "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
        "riskFlags": [
          {
            "type": "needs_user_fact",
            "message": "结果数据必须由用户提供，Agent 不应编造。"
          }
        ]
      }
    ]
  },
  "usage": {
    "provider": "openai-compatible",
    "model": "deepseek-chat",
    "inputTokens": 620,
    "outputTokens": 180
  }
}
```

Rules:

- `resume-diagnose` accepts `target.kind=resume`.
- `section-next-steps` accepts `target.kind=section` and requires `target.section`.
- `context.sections[*].plainText` is capped by Web before forwarding and capped again by Agent validation.
- Agent suggestions cannot claim facts, numbers, technologies, companies, schools, awards, or outcomes not present in the provided context.
- Web displays suggestions and lets users edit manually. Phase 2A does not auto-apply generated patches.

## Agent Messages Contract

Phase 3A 计划新增聊天式 Agent Mode。该能力使用 assistant-ui 承载多轮 thread、composer 和 tool display，但产品状态仍由 Web 编辑器掌管。

重要边界：

- Phase 3A UI 形态是 **Agent Mode replaces left editor**：用户点击 `Agent 模式` 后，左侧编辑列切换为 Agent panel，右侧 `LivePreview` 保持可见。
- `POST /v1/agent/messages` 只服务新增 Agent 能力，不迁移 OCR、导入简历、AI 解析。
- Agent 可以为推理调用基础简历修改 tools，但只能返回 `proposedPatches`。
- Web 只有在用户点击 `应用` 后才把 `ResumePatch` 写入 React Hook Form 并触发 autosave。
- Agent 不连接 Postgres，不发布简历，不删除 section，不自动切模板。

### `POST /v1/agent/messages`

用途：assistant-ui Agent panel 的消息入口。它接收 Web 裁剪后的当前 RHF 简历快照、聊天消息和 preset workflow，返回 assistant 消息、可见 tool calls 和待用户确认的 `ResumePatch`。

认证：`Authorization: Bearer <agent-jwt>`，scope 必须是 `agent:chat`。JWT 的 `resumeId` 必须与请求体 `resumeId` 一致。

Phase 3A 支持的 preset workflows：

| Workflow ID | Purpose |
| --- | --- |
| `resume-diagnose` | 诊断整份简历，给出优先级最高的改进点 |
| `target-role-match` | 对照目标岗位检查匹配度，缺目标岗位时先追问 |
| `experience-star` | 用 STAR 原则优化经历，但不编造 Result 指标 |
| `pre-export-check` | 导出前检查内容和格式风险 |

Phase 3A 基础 tools：

| Tool | Can read | Can return | Direct write? |
| --- | --- | --- | --- |
| `inspect_resume` | Web 提供的 capped resume context | 结构诊断、缺口、风险 | No |
| `propose_rich_text_rewrite` | 目标富文本 field 的 plain text 和上下文 | `replace_tiptap_json` patch | No |
| `propose_summary_rewrite` | `basics.summary` 和上下文 | `replace_plain_text` patch | No |
| `propose_bullet_rewrite` | 列表型 TipTap field 的 plain text 和结构摘要 | 保持列表结构的 `replace_tiptap_json` patch | No |
| `draft_section_item` | 简历摘要、目标 section、用户目标 | 新 section/item 草稿 patch | No |

Request:

```json
{
  "resumeId": "resume_abc",
  "locale": "zh-CN",
  "workflowId": "resume-diagnose",
  "messages": [
    {
      "id": "msg_user_1",
      "role": "user",
      "content": "请诊断这份简历，并优先指出最值得修改的一处。"
    }
  ],
  "context": {
    "resumeTitle": "前端工程师",
    "templateId": "professional",
    "activeSection": null,
    "completeness": {
      "overall": 76,
      "sections": [
        { "key": "experience", "label": "工作经历", "score": 18, "max": 25 }
      ]
    },
    "sections": [
      {
        "key": "experience",
        "label": "工作经历 1",
        "fieldPath": "experience.0.content",
        "plainText": "负责后台系统开发，优化页面性能。"
      }
    ]
  }
}
```

Success response:

```json
{
  "status": "ok",
  "requestId": "req_01H...",
  "message": {
    "id": "msg_assistant_1",
    "role": "assistant",
    "content": "我先看了整体结构，最值得优先优化的是第一段工作经历：它有动作，但缺少业务背景和结果证据。"
  },
  "toolCalls": [
    {
      "id": "tool_1",
      "name": "inspect_resume",
      "status": "completed",
      "title": "检查简历结构",
      "summary": "已检查 1 个工作经历段落，发现结果证据不足。",
      "input": { "scope": "resume" },
      "result": { "topIssue": "工作经历缺少结果证据" }
    }
  ],
  "proposedPatches": [
    {
      "id": "patch_1",
      "toolCallId": "tool_1",
      "label": "优化工作经历第一段",
      "section": "experience",
      "fieldPath": "experience.0.content",
      "operation": "replace_tiptap_json",
      "beforePlainText": "负责后台系统开发，优化页面性能。",
      "afterPlainText": "围绕后台系统的页面性能问题，梳理核心页面加载链路并推进前端优化；请补充具体指标后再写入最终结果。",
      "replacementTiptapJson": {
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "围绕后台系统的页面性能问题，梳理核心页面加载链路并推进前端优化；请补充具体指标后再写入最终结果。"
              }
            ]
          }
        ]
      },
      "changeSummary": "按 STAR 补足任务与行动，但没有编造结果指标。",
      "riskFlags": [
        {
          "type": "needs_user_fact",
          "message": "需要用户补充性能提升指标或业务影响。"
        }
      ]
    }
  ],
  "usage": {
    "provider": "openai-compatible",
    "model": "deepseek-chat",
    "inputTokens": 1000,
    "outputTokens": 300
  }
}
```

Allowed `ResumePatch.fieldPath` in Phase 3A:

- `basics.summary`
- `experience.<index>.content`
- `projects.<index>.content`
- `education.<index>.highlights`
- `research.<index>.content`
- `skills`
- `custom.<index>.content`

Patch rules:

- `replace_plain_text` 只能用于 `basics.summary`。
- `replace_tiptap_json` 用于富文本字段，必须保持原有段落/列表语义；原文是有序或无序列表时，润色结果也必须是对应列表结构，而不是一整段无结构文本。
- `riskFlags` 必须标记需要用户补事实的地方，特别是 STAR 的 Result 指标。
- Agent provider 输出必须是 JSON；Agent 负责解析和 allowlist 校验，失败返回 `dependency_unavailable` 或 `bad_request`。
- Web 展示 `proposedPatches` 的确认卡；用户点击 `应用` 后才 `setValue` 到 RHF，并 dispatch `resume:flush-autosave`。

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
