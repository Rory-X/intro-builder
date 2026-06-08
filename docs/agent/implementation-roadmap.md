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

Status: Phase 2A implemented locally and verified, pending normal PR/deploy flow.

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

Candidate helpers:

- Phase 2A: `resume-diagnose`
- Phase 2A: `section-next-steps`
- Later Phase 2B candidate: `summary:suggest`
- Later Phase 2B candidate: `experience:quantify`
- Later Phase 2B candidate: `project:impact`
- Later Phase 2B candidate: `skills:dedupe`

Rules:

- 输出 suggestion，不直接写回。
- 输入按 section 裁剪，不把整份 resume 盲目塞给模型。
- 每个 helper 有独立 scope 和 rate limit。
- 失败不阻塞编辑器。

Exit gates:

- 每个 helper 有 schema、prompt、route tests。
- Phase 2A Web UI 只展示建议；Phase 2B 生成内容类 helper 才设计 apply/cancel。
- rate limit key 按 helper scope 分离。

## Phase 3: assistant-ui Agent Panel

Goal: 引入聊天式 Agent panel，承载多轮对话和可见 tool calling。

Use assistant-ui here, not earlier.

Recommended architecture:

```text
AgentPanel -> Next /api/agent/messages -> Agent /v1/agent/messages
```

Deliverables:

- assistant-ui runtime provider。
- Agent panel trigger。
- Right-side Sheet panel。
- Stream adapter matching selected assistant-ui protocol。
- Tool call display。
- Human-confirmed writeback actions。
- Lazy loading to protect editor initial bundle。

Exit gates:

- Panel opens without resetting RHF form。
- Message stream completes under selected protocol。
- Tool calls render but cannot mutate resume without confirmation。
- Closing panel does not break autosave。
- Mobile Sheet smoke passes。

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
