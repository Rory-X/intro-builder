# Agent Service Contracts

本文档定义 Web 主站与 Agent 微服务之间的接口契约。实现前先改这里；代码必须跟这里保持一致。

## Base URL

本地开发：

```bash
http://127.0.0.1:8787
```

部署后由 Caddy 暴露域名和路径前缀。Web 服务端通过 `AGENT_BASE_URL`
指向该地址；Agent Mode 直连流通过 `/api/agent/direct-runs` 返回的
`AGENT_PUBLIC_BASE_URL` 让浏览器直接连接同一地址：

```bash
https://api.rory-x.me/intro-builder/agent
```

根 `.env.example` 已预留 `AGENT_BASE_URL` 和 `AGENT_PUBLIC_BASE_URL`。
本地开发可以都指向 `http://127.0.0.1:8787`，生产环境统一指向上面的公网路径。

直连浏览器请求会带 `Authorization: Bearer <short Agent JWT>`，所以 Agent
服务必须配置允许来源：

```bash
AGENT_CORS_ORIGINS=https://intro-builder.vercel.app,http://localhost:3000
```

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

## Business API Versioning

业务 API 从 `/v1` 开始。基础健康检查可以保留根路径，但业务能力必须版本化。

Business endpoints:

| Endpoint | Phase | Purpose |
| --- | --- | --- |
| `GET /v1/session` | Phase 0C | 已实现：验证 Web 签发的 Agent JWT 与 scope |
| `POST /v1/rich-text/polish` | Phase 1 | 富文本局部润色 |
| `POST /v1/resume/helpers/:helperId` | Phase 2 | 简历模块级增量 helper |
| `POST /v1/agent/chat` | Agent Mode v2 | assistant-ui / AG-UI AgentPanel 长 loop SSE 入口 |

Current Agent Mode v2 status:

- Implemented locally: shared `AgentMessageRequest`/`AgentMessageResponse` types, capped chat context builder, Agent service `POST /v1/agent/chat` route, Web BFF `POST /api/agent/direct-runs`, assistant-ui runtime provider, left-column Agent panel, confirmation cards, RHF writeback dispatcher, and mobile Agent Sheet.
- Implemented locally: Agent Mode v2 uses AG-UI `text/event-stream` with `@ag-ui/core` event types and `@ag-ui/encoder`; the browser receives `streamUrl` plus short token from the BFF and connects directly to Agent.
- JSON response is not the product chat protocol after Phase 3B. It remains only as a compatibility/debug fallback for service tests and non-browser smoke.
- The proto file is an IDL draft to keep naming aligned; it is not a requirement to introduce gRPC and must not override the AG-UI event stream contract.

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

Phase 3 已新增聊天式 Agent Mode。该能力使用 assistant-ui 承载多轮 thread、composer 和 tool display，但产品状态仍由 Web 编辑器掌管。

重要边界：

- Phase 3 UI 形态是 **Agent Mode replaces left editor**：用户点击 `Agent 模式` 后，左侧编辑列切换为 Agent panel，右侧 `LivePreview` 保持可见；移动端使用底部 Agent Sheet。
- `POST /v1/agent/chat` 只服务新增 Agent 能力，不迁移 OCR、导入简历、AI 解析。
- Agent 可以为推理调用基础简历修改 tools，但只能返回 `proposedOperations`。
- Web 只有在用户点击 `应用` 后才把 `ResumeOperation` 写入 React Hook Form 并触发 autosave。
- Agent 不连接 Postgres，不发布简历，不删除 section，不自动切模板。
- Agent Mode v2 使用 AG-UI `text/event-stream`；JSON response 仅保留为非 SSE 兼容和 debug fallback。
- 当前 Agent panel 浏览器入口是 Web BFF `/api/agent/direct-runs`。该 route 接收标准 AG-UI `RunAgentInput`，从 `forwardedProps.introBuilder` 映射到本节的 `AgentMessageRequest`，校验 Auth.js session 与 resume ownership，签发短期 `agent:chat` JWT，并返回 Agent `/v1/agent/chat` stream URL。

### `POST /v1/agent/chat`

用途：assistant-ui Agent panel 的长 loop 消息入口。它接收 Web 裁剪后的当前 RHF 简历快照、聊天消息、preset workflow 和 session snapshot，默认返回 AG-UI SSE events：assistant 消息增量、step tool result、workspace delta、question interrupt 和待用户确认的 `ResumeOperation`。

认证：`Authorization: Bearer <agent-jwt>`，scope 必须是 `agent:chat`。JWT 的 `resumeId` 必须与请求体 `resumeId` 一致。

Phase 3 支持的 preset workflows：

| Workflow ID | Purpose |
| --- | --- |
| `resume-diagnose` | 诊断整份简历，给出优先级最高的改进点 |
| `target-role-match` | 对照目标岗位检查匹配度，缺目标岗位时先追问 |
| `experience-star` | 用 STAR 原则优化经历，但不编造 Result 指标 |
| `pre-export-check` | 导出前检查内容和格式风险 |

Agent Mode v2 tool taxonomy:

| Tool | Can read | Can return | Direct write? |
| --- | --- | --- | --- |
| `resume_read` | Web 提供的 capped resume context | 结构诊断、缺口、风险 | No |
| `get_completeness` | draft sections | 完整度、缺失模块 | No |
| `set_goal` | 用户目标与 session workspace | 标题/目标岗位元信息 | No |
| `role_match_read` | 目标岗位、简历事实 | 岗位匹配缺口 | No |
| `ats_check` | 简历文本、目标关键词 | ATS 可读性与关键词风险 | No |
| `content_claim_audit` | 简历文本、draft operations | 编造风险、无证据数字、过强表述 | No |
| `layout_fit_check` | 模板、内容密度、draft snapshot | 版式风险 | No |
| `section_quality_score` | 指定 section 文本 | 结构、可信度、具体性评分 | No |
| `resume_update_section` | 目标 section/field 的 plain text、TipTap JSON 和上下文 | `update_section` operation | No |
| `resume_delete_section` | section/item target | `delete_section` operation | No |
| `resume_reorder_sections` | 当前 section order | `reorder_sections` operation | No |
| `resume_insert_section` | 简历摘要、目标 section、用户目标 | `insert_section` operation | No |
| `resume_polish_text` | 目标 field 文本/TipTap JSON | `update_section` operation | No |
| `resume_set_text` | 目标 field 与纯文本 | `update_section` or `insert_section` operation | No |
| `resume_ask` | 缺失事实描述 | `input_required` interrupt | No |

命名规则：

- internal loop tools 是模型实际可调用工具；visible operation tools 是前端展示和确认写回的工具/operation 语义。两层都必须在 shared types、Agent validator、Web extractor 和文档中对齐。
- 早期草案里出现过的 `inspect_resume`、`propose_*`、`draft_section_item`、`suggest_rewrite`、`draft_section`、`explain_template` 不属于当前 Phase 3B contract；如需恢复，必须先更新本文件、proto、Agent validator 和 Web confirmation 语义。
- 不按 workflow 新增 tool。`resume-diagnose`、`target-role-match`、`experience-star`、`pre-export-check` 只能改变 starter prompt、tool policy 和输出解释，不改变 tool 名称集合。

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

### Web BFF `POST /api/agent/direct-runs`

用途：assistant-ui / AG-UI SDK 兼容入口。浏览器先调用 Web BFF；Web BFF 校验 Auth.js session、resume ownership，再签发 `agent:chat` token，并返回 Agent `/v1/agent/chat` stream URL。随后浏览器携短期 token 直连 Agent SSE。

Request 是 AG-UI `RunAgentInput`，必须包含 intro-builder metadata：

```json
{
  "threadId": "resume_abc",
  "runId": "run_123",
  "state": null,
  "messages": [
    {
      "id": "msg_user_1",
      "role": "user",
      "content": "请诊断这份简历"
    }
  ],
  "tools": [],
  "context": [],
  "forwardedProps": {
    "introBuilder": {
      "resumeId": "resume_abc",
      "locale": "zh-CN",
      "workflowId": "resume-diagnose",
      "context": {
        "resumeTitle": "前端工程师",
        "templateId": "professional",
        "activeSection": null,
        "completeness": { "overall": 76, "sections": [] },
        "sections": []
      }
    }
  }
}
```

兼容 assistant-ui `useAgUiRuntime` 的 `runConfig.custom` 注入方式时，也允许：

```json
{
  "forwardedProps": {
    "runConfig": {
      "introBuilder": {
        "resumeId": "resume_abc",
        "locale": "zh-CN",
        "workflowId": "resume-diagnose",
        "context": {}
      }
    }
  }
}
```

Rules:

- `forwardedProps.introBuilder.context` 必须来自 Web 当前 RHF 快照的 capped context，不能由 assistant-ui thread state 伪造完整简历内容。
- Web BFF 必须先校验 `resumeId` 属于当前用户，再签发 Agent JWT。
- Response 是 JSON bootstrap，包含 `streamUrl`、`token`、`tokenExpiresAt` 和带 `sessionContext` 的 Agent request。
- `/api/agent/messages` 和 `/api/agent/runs` 只作为旧 JSON/SSE contract 的兼容背景；Agent panel 新请求走 `/api/agent/direct-runs`。

Compatibility/debug response when `Accept: application/json` or no SSE is requested:

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
      "name": "resume_update_section",
      "status": "completed",
      "title": "检查简历结构",
      "summary": "已检查 1 个工作经历段落，发现结果证据不足。",
      "input": { "scope": "resume" },
      "result": { "topIssue": "工作经历缺少结果证据" }
    }
  ],
  "proposedOperations": [
    {
      "id": "op_1",
      "toolCallId": "tool_1",
      "label": "优化工作经历第一段",
      "section": "experience",
      "fieldPath": "experience.0.content",
      "operation": "update_section",
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

Product response when `Accept: text/event-stream`:

```text
content-type: text/event-stream
cache-control: no-cache, no-transform

data: {"type":"RUN_STARTED","threadId":"resume_abc","runId":"req_01H..."}

data: {"type":"TEXT_MESSAGE_START","messageId":"msg_assistant_1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"msg_assistant_1","delta":"我先看了整体结构..."}

data: {"type":"TOOL_CALL_START","toolCallId":"tool_1","toolCallName":"resume_update_section","parentMessageId":"msg_assistant_1"}

data: {"type":"TOOL_CALL_ARGS","toolCallId":"tool_1","delta":"{\"fieldPath\":\"experience.0.content\"}"}

data: {"type":"TOOL_CALL_END","toolCallId":"tool_1"}

data: {"type":"TOOL_CALL_RESULT","messageId":"tool_1_result","toolCallId":"tool_1","role":"tool","content":"{\"toolCall\":{...},\"proposedOperations\":[...]}"}

data: {"type":"TEXT_MESSAGE_END","messageId":"msg_assistant_1"}

data: {"type":"RUN_FINISHED","threadId":"resume_abc","runId":"req_01H...","outcome":{"type":"success"}}
```

Allowed `ResumeOperation.fieldPath` in Phase 3B:

- `basics.summary`
- `sectionOrder`
- `experience.<index>.content`
- `projects.<index>.content`
- `education.<index>.highlights`
- `research.<index>.content`
- `skills`
- `custom.<index>.content`

Patch rules:

- `update_section` 用于 `basics.summary` 或 allowlist 富文本字段；富文本字段必须携带 `replacementTiptapJson`，并保持原有段落/列表语义。原文是有序或无序列表时，润色结果也必须是对应列表结构，而不是一整段无结构文本。
- `reorder_sections` 必须携带非空 `sectionOrder`，并包含 `basics`。
- `delete_section` 与 `insert_section` 当前只允许作为待确认 operation 展示；Web dispatcher 在没有更细数组 item identity 和模块管理器测试前不会自动执行。
- `riskFlags` 必须标记需要用户补事实的地方，特别是 STAR 的 Result 指标。
- Agent provider 输出必须是 JSON；Agent 负责解析和 allowlist 校验，失败返回 `dependency_unavailable` 或 `bad_request`。
- Web 展示 `proposedOperations` 的确认卡；用户点击 `应用` 后才 `setValue` 到 RHF，并 dispatch `resume:flush-autosave`。

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

## AI Result Cache

Agent 生成类接口会在 auth、resumeId match、请求校验和 provider 配置检查之后计算缓存 key。缓存命中时直接返回结构化结果，不再调用模型 provider，也不进入模型 rate limit；JWT replay guard 仍照常执行。

Cache key format:

```text
ai_cache:{scope}:{userHash}:{resumeHash}:{inputHash}
```

`inputHash` 包含 scope、validated request payload、prompt/cache version 和 model name。prompt 或模型变化会自然生成新 key。

TTL:

| Scope | TTL |
| --- | --- |
| `rich_text:polish` | 7 days |
| `resume:helper` | 24 hours |
| `agent:chat` | 10 minutes |

Cache hit responses add:

```json
{
  "cached": true,
  "cachedAt": "2026-06-09T00:00:00.000Z"
}
```

Rules:

- Redis cache value stores parsed structured responses, not raw provider text.
- Cache entries must always have TTL.
- Cache read/write failures must not turn a successful model call into a failed request.
- `agent:chat` cache is exact-request caching only; it is not semantic conversation memory.
