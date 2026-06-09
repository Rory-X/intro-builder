# Agent Implementation Roadmap

本文档是 Agent 微服务的长期实施方案。每个 phase 都应该形成可验证、可回滚的小切片。

## Phase 0A: Service Foundation

Status: implemented.

Delivered:

- `apps/agent` workspace package。
- Node/TypeScript HTTP service。
- `/health`、`/ready`、404、405。
- Dockerfile、compose、Caddyfile、env example。
- Hong Kong server Docker/Compose/Caddy deployment foundation。
- GitHub Actions deployment workflow for Agent path changes on `main`。
- Agent package tests。
- Root `pnpm test` 串跑 Agent tests。

Verification already run:

```bash
pnpm verify
pnpm agent:build
actionlint .github/workflows/deploy-agent.yml
```

Remaining notes:

- Server-local Docker/Caddy smoke has passed. Public HTTPS is live at `https://api.rory-x.me/intro-builder/agent`; see `docs/agent/deployment.md`。

## Phase 0B: Redis and Reliability Layer

Status: implemented locally, pending normal merge/deploy flow.

Goal: 在模型调用前先接好 Redis、readiness、rate limit 和依赖降级。

Delivered:

- Redis client factory。
- Config 增加 `REDIS_URL`、connect timeout、rate limit 参数。
- `/ready` 检查 Redis。
- `/health` 保持仅进程检查。
- Redis-backed rate limit 原语。
- Request id response header and JSON error envelope。
- Fake Redis tests，不依赖真实本地 Redis。
- `.env.example` 打开 `REDIS_URL=redis://127.0.0.1:6379`。
- compose 中 agent 使用 `redis://redis:6379`。
- Docker runner 改为 scoped production install，包含 Agent runtime dependencies。
- Redis-down readiness probe 有硬超时，避免 node-redis reconnect 导致 `/ready` 悬挂。

Recommended implementation order:

1. 写 `apps/agent/tests/redis.test.ts`，定义 Redis ready/unready 行为。
2. 写 `apps/agent/src/redis.ts`，实现 lazy client factory。
3. 修改 `apps/agent/src/config.ts`，增加 Redis 配置。
4. 修改 `apps/agent/src/http.ts`，让 `/ready` 使用 dependency checker。
5. 写 `apps/agent/tests/rate-limit.test.ts`。
6. 写 `apps/agent/src/rate-limit.ts`。
7. 更新 `.env.example` 和 compose env。
8. 跑本地 Redis smoke。

Exit gates:

```bash
redis-cli ping
pnpm agent:test
pnpm agent:typecheck
pnpm agent:build
pnpm verify
```

Manual smoke:

```bash
AGENT_HOST=127.0.0.1 AGENT_PORT=8789 REDIS_URL=redis://127.0.0.1:6379 pnpm agent:start
curl -sS http://127.0.0.1:8789/ready

AGENT_HOST=127.0.0.1 AGENT_PORT=8790 REDIS_URL=redis://127.0.0.1:6390 REDIS_CONNECT_TIMEOUT_MS=100 pnpm agent:start
curl -sS http://127.0.0.1:8790/health
curl -sS http://127.0.0.1:8790/ready
```

Expected:

- Redis running: `/ready` returns ready.
- Redis stopped: `/health` returns ok, `/ready` returns dependency unavailable.

## Phase 0C: Web-to-Agent Auth and Client

Status: implemented locally, pending normal merge/deploy flow.

Goal: 建立稳定的 Web -> Agent 调用层和短期 JWT 认证边界。

Deliverables:

- Web server-only Agent JWT signer。
- Agent JWT verifier。
- Request id propagation。
- Web Agent client wrapper。
- `GET /v1/session` protected route。
- Web BFF smoke route `GET /api/agent/session`。
- Redis `jti` replay guard。
- Tests for valid token, expired token, wrong issuer/audience, wrong scope, missing token, replayed `jti`, Web signer, Web client, Web BFF route。

Recommended files:

- `lib/agent/client.ts`
- `lib/agent/token.ts`
- `app/api/agent/session/route.ts`
- `apps/agent/src/auth.ts`
- `apps/agent/src/errors.ts`
- `apps/agent/tests/auth.test.ts`
- `apps/agent/tests/http.test.ts`
- `tests/unit/agent-token.test.ts`
- `tests/unit/agent-client.test.ts`
- `tests/unit/agent-session-route.test.ts`

Exit gates:

```bash
pnpm agent:test
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Security requirements:

- Web 校验 resume ownership 后才签发 token。
- JWT TTL 建议 60 到 180 秒。
- JWT 必须含 `scope`。
- Agent 校验 `iss`、`aud`、`exp`、`scope`。
- `jti` 进入 Redis replay guard。

Deployment note:

- Agent protected routes require `AGENT_JWT_SECRET` in the Agent server env.
- Web BFF signing requires the same `AGENT_JWT_SECRET` in the Web production env.
- CD writes `AGENT_JWT_SECRET` only when the GitHub Secret exists; it does not create a default production secret.

## Phase 1: Rich Text Polish MVP

Goal: 在 Agent 微服务上实现第一个新增 AI 能力：单个富文本字段的局部润色。

Not using assistant-ui.

Deliverables:

- `POST /v1/rich-text/polish`。
- Prompt builder。
- Provider adapter。
- Streaming response。
- `RichTextEditor` toolbar polish button。
- Suggestion popover/card。
- User confirm writeback。
- Autosave flush。
- Rate limit。

Key frontend files:

- `components/editor/rich-text-editor.tsx`
- `components/agent/rich-text-polish-button.tsx`
- `components/agent/polish-suggestion-popover.tsx`

Key agent files:

- `apps/agent/src/routes/rich-text-polish.ts`
- `apps/agent/src/prompts/rich-text-polish.ts`
- `apps/agent/src/providers/openai.ts`

Exit gates:

- Unit tests for prompt input shaping。
- Agent route tests for auth, rate limit, provider timeout。
- Frontend tests for apply/cancel behavior。
- Manual editor smoke: polish -> apply -> preview updates -> autosave flush。

## Phase 2: Resume Helper APIs

Status: Phase 2A implemented locally and verified. Phase 2B is intentionally skipped while Phase 3A Agent Mode proceeds.

Goal: 增量扩展到简历模块级 helper，但仍不是聊天面板。

Phase 2A delivered:

- Agent route `POST /v1/resume/helpers/:helperId`。
- Web BFF route `POST /api/agent/resume/helpers/[helperId]`。
- Helper IDs: `resume-diagnose` and `section-next-steps`。
- Required Agent JWT scope: `resume:helper`。
- Web-side Auth.js session and resume ownership check before proxying。
- RHF snapshot context builder with capped plain text。
- Editor toolbar `AI 诊断` entry and section header `AI 建议` entries。
- Suggestion card UI only; no generated patch apply and no automatic RHF writeback。
- Tests for Agent domain, Agent HTTP route, Web client, Web BFF, context builder, and UI components。
- Verification passed: `pnpm verify` and `pnpm agent:build`。

Deferred helpers:

- Phase 2A: `resume-diagnose`
- Phase 2A: `section-next-steps`
- Not active without a new plan: `summary:suggest`
- Not active without a new plan: `experience:quantify`
- Not active without a new plan: `project:impact`
- Not active without a new plan: `skills:dedupe`

Rules:

- 输出 suggestion，不直接写回。
- 输入按 section 裁剪，不把整份 resume 盲目塞给模型。
- 每个 helper 有独立 scope 和 rate limit。
- 失败不阻塞编辑器。

Exit gates:

- 每个 helper 有 schema、prompt、route tests。
- Phase 2A Web UI 只展示建议；任何生成内容类 helper 都必须另开 plan 设计 apply/cancel，不要在 Phase 3A 中顺手实现。
- rate limit key 按 helper scope 分离。

## Phase 3: assistant-ui Agent Panel

Status: implemented, merged, and deployed by PR #43. Design and execution references are `docs/superpowers/specs/2026-06-09-agent-mode-streaming-phase-3b-design.md` and `docs/superpowers/plans/2026-06-09-agent-mode-streaming-phase-3b.md`.

Goal: 引入聊天式 Agent Mode，承载多轮对话、可见 tool calling 和基础简历修改建议；首版左侧编辑列切换为 Agent panel，右侧 `LivePreview` 保持可见。

Use assistant-ui here, not earlier.

Current Phase 3B production status:

- Implemented and merged: browser-safe message/tool/operation types, capped chat context, Agent service tool validation, Agent message prompt/parser, and Agent `/v1/agent/messages` route.
- Implemented and merged: Web client/BFF `POST /api/agent/messages` with Auth.js/dev-bypass user lookup, resume ownership check, `agent:chat` token signing, JSON fallback, AG-UI SSE proxying, and structured error mapping.
- Implemented and merged: assistant-ui LocalRuntime async generator, left-column Agent panel, preset workflow call to Web BFF, streamed text rendering, tool cards, confirmation cards, toolbar `Agent 模式` toggle, preview-preserving editor switch, and mobile Agent Sheet.
- Implemented and merged: Web-owned confirmed writeback for `update_section` and `reorder_sections`; `delete_section`/`insert_section` remain displayed operations until array item identity and module manager tests are added.
- Verified before merge: `pnpm test`, `pnpm tsc --noEmit`, `pnpm agent:build`, `pnpm lint`, `pnpm build`。
- Verified on `main`: GitHub Actions CI run `27191002056` passed, Agent CD run `27191002053` passed, Vercel status for merge commit `c36362c33239` passed, and public Agent `/health` plus `/ready` returned `HTTP/2 200` with version `github-c36362c33239`。

Recommended architecture:

```text
Editor toolbar Agent 模式
  -> left editor column AgentPanel
  -> assistant-ui LocalRuntime/custom async generator
  -> Next /api/agent/runs
  -> RunAgentInput -> AgentMessageRequest adapter
  -> Agent /v1/agent/messages
  -> AG-UI SSE
  -> minimal resume operation tools
  -> provider
```

Deliverables:

- assistant-ui runtime provider。
- `Agent 模式` toolbar toggle，文字和 icon 渐变，背景不渐变。
- Left-column Agent panel shell，替换编辑表单视觉但不接管 RHF。
- Preset workflows: `诊断整份简历`、`目标岗位匹配`、`经历 STAR 优化`、`终检导出前检查`。
- AG-UI `text/event-stream` message adapter for Phase 3B。
- `POST /v1/agent/messages` with scope `agent:chat`。
- Web BFF `POST /api/agent/messages` with Auth.js session and resume ownership check。
- Tool call display。
- Basic resume modification tools:
  - `resume_read`
  - `resume_update_section`
  - `resume_delete_section`
  - `resume_reorder_sections`
  - `resume_insert_section`
- `ResumeOperation` confirmation cards with `应用` / `忽略`。
- Human-confirmed writeback via RHF `setValue` and `resume:flush-autosave`。
- Lazy loading to protect editor initial bundle。
- Mobile Agent Sheet。

Protocol and tool constraints:

- Phase 3B Agent conversation uses AG-UI SSE as the product protocol. JSON remains only as service debug fallback.
- All conversation event code should use `@ag-ui/core` event types and `@ag-ui/encoder` rather than custom NDJSON/DataStream formats.
- Minimal resume tools are fixed to `resume_read`、`resume_update_section`、`resume_delete_section`、`resume_reorder_sections`、`resume_insert_section`.
- Workflows must not introduce separate tool names; they only constrain prompts, policies, and how `ResumeOperation` cards are explained.

Exit gates:

- `Agent 模式` opens from desktop editor toolbar。
- Left panel switches to Agent panel while right `LivePreview` remains visible。
- FormProvider/RHF state, section order, template state, and autosave queue are not reset。
- Contract smoke: tests cover clicking `诊断整份简历`, Web BFF SSE request, streamed assistant message, tool card rendering, and confirmation card rendering。
- At least one proposed `ResumeOperation` can render as a confirmation card。
- Patch does not mutate resume content before `应用`。
- Confirmed patch writes through existing RHF path and triggers autosave flush。
- Rich text list patches preserve ordered/unordered list structure instead of collapsing to one paragraph。
- Agent unavailable degrades to a Chinese error state without breaking normal editor typing。
- Phase 3A desktop passes; mobile Sheet is explicitly Phase 3B, not an exit gate for this slice。

### Phase 3C: Realtime Streaming and SDK-Compatible Stability

Status: implemented locally on `codex/agent-realtime-streaming-stability`, pending full gates and PR.

Goal: 修复用户可感知的不稳定对话流，让 Agent Mode 接近 ChatGPT 的实时吐字体验，同时为 `@ag-ui/client` / `@assistant-ui/react-ag-ui` runtime 迁移铺好 BFF adapter。

Delivered locally:

- Agent `agent:chat` cache hit 在 `Accept: text/event-stream` 时返回 AG-UI SSE，而不是 JSON。
- Agent SSE provider parse/throw failures 返回 `RUN_ERROR`，并保留 code/request id。
- Web `streamAgentMessage()` 清晰区分 JSON total timeout 与 stream connection timeout，避免长流被 10 秒误杀。
- OpenAI-compatible Agent provider 支持 `stream: true`，从 provider JSON 的 `message.content` 字符串中安全提取可见增量，不向用户显示 JSON braces。
- Provider stream 完成后仍用现有 parser/validator 校验完整 JSON，再发 tool result、proposed operations，并写 AI cache。
- 新增 `POST /api/agent/runs`：接收 AG-UI `RunAgentInput`，从 `forwardedProps.introBuilder` 或 `forwardedProps.runConfig.introBuilder` 映射到现有 Agent request。
- AgentPanel 当前仍使用 LocalRuntime/custom adapter 以保留确认卡体验，但浏览器请求已切到 `/api/agent/runs` 的 SDK-compatible body。
- 新增依赖 `@ag-ui/client@0.0.56`、`@assistant-ui/react-ag-ui@0.0.36`，版本与 `@ag-ui/core` / `@ag-ui/encoder` 对齐。

Next candidate slice:

- 用 `HttpAgent({ url: "/api/agent/runs" })` + `useAgUiRuntime({ agent })` 替换 LocalRuntime。
- 替换前必须先证明 assistant-ui `tool-call` parts 能继续驱动 `AgentToolCard` 与 `AgentConfirmationCard`，且不会直接写 RHF。

## Phase 4: BYO Key, Credits, and Limits

Goal: 在产品验证后补商业化与自助配置。

Deliverables:

- BYO key storage design。
- Credits ledger design。
- Provider routing。
- Quota UI。
- Rate limit tiers。
- Audit logs。

Rules:

- 不阻塞 Phase 1 到 Phase 3。
- 不提前污染 MVP API。
- Provider key 不进浏览器。

## Always Out of Scope Unless a New Plan Says Otherwise

- OCR migration。
- Resume import migration。
- Existing AI parsing migration。
- Direct DB writes from Agent。
- assistant-ui for single polish button。
- Long-running autonomous resume edits without human confirmation。
