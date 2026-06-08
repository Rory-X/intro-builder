# AI Agent Microservice Managed Work Plan

> **For agentic workers:** 本文档只用于环境与规划准备，不授权开始 `apps/agent` 或任何 Agent 微服务功能实现。待用户确认后，再进入 spec / implementation plan / TDD / coding。

**Goal:** 为 `intro-builder` 的新增 Agent 能力准备一个由 Codex app 托管的独立 worktree、开发分支和分阶段实施蓝图，确保后续开发从一开始就与现有 Web 应用、已上线基础 AI 能力和独立部署约束解耦。

**Architecture:** 继续保留当前 Next.js Web 应用作为主站与编辑器宿主，只让它负责 auth、短期 Agent JWT、编辑器 UI、React Hook Form 状态、preview 与 autosave。新增 Agent 能力另起独立微服务，负责模型调用、prompts、streaming、tool calling、Redis memory / rate limit、Docker / Caddy 部署；两者通过受约束的服务接口通信。

**Tech Stack:** Next.js 16 App Router, React 19, Auth.js v5, React Hook Form, Redis, Docker, Caddy, 独立 Agent 微服务（实现技术待 Phase 0 定案）。

---

## 本次边界

### In Scope

- 为新增 Agent 能力准备独立微服务的阶段规划。
- 明确 Web 主站与 Agent 微服务的职责边界。
- 确认 worktree、分支与基线命令，为后续迭代提供干净起点。

### Out of Scope

- 不开始实现 `apps/agent`、`services/agent` 或任何实际 Agent 运行时代码。
- 不迁移已上线的 OCR、导入简历、AI 解析能力。
- 不把 `assistant-ui` 提前引入到单个富文本润色按钮。
- 不修改现有 Web 端的编辑器、preview、autosave 主流程行为。

## 已确认约束

1. 本次 Agent 服务只承载新增的 Agent 相关 AI 能力。
2. 香港 `2C4G` 服务器已购买一年，新增 Agent 能力必须部署到独立微服务。
3. 现有 OCR、导入简历、AI 解析属于已上线基础 AI 辅助能力，不纳入本次微服务迁移。
4. Web 端继续负责 auth、短期 Agent JWT、编辑器 UI、React Hook Form 状态、preview、autosave。
5. Agent 微服务负责新增 Agent 模型调用、prompts、streaming、tool calling、Redis memory / rate limit、Docker / Caddy 部署。
6. `assistant-ui` 只作为后续聊天式 Agent UI 层，不用于单个富文本润色按钮。

## 总体策略

- 先固化边界，再落基础设施，最后逐步扩大 Agent 能力入口。
- Phase 1 只做“富文本润色 MVP”这一个最小可验证切片，避免一开始就把简历全局 Agent、聊天 UI、计费体系耦在一起。
- 每一阶段都要求保留 Web 主站可单独运行的能力，不让 Agent 微服务成为编辑器基本功能的阻塞点。
- Redis、部署、认证边界和观测性在前置阶段定好，否则后续每加一个 Agent 能力都要返工。

## 阶段规划

### Phase 0 — 微服务基础与契约冻结

**目标:** 在不写业务功能的前提下，确定独立 Agent 微服务的运行边界、目录结构、部署约束、鉴权方式和运维基线。

**交付物:**

- 微服务与 Web 主站的责任矩阵。
- Web -> Agent 的短期 JWT 方案草案。
- Redis 用途拆分草案：conversation memory、rate limit、job / stream state 是否共用实例。
- Docker / Caddy / 香港 `2C4G` 服务器的部署拓扑草案。
- 环境变量清单与 secrets ownership 约定。
- 观测性最低要求：结构化日志、request id、provider error 分类、stream trace 基础字段。

**关键决策:**

- 选定微服务实现语言 / 框架时，要优先服务 streaming、tool calling、Redis 集成和 Docker 部署，不以复用 Web 端代码为第一目标。
- Web 端只签发短期 Agent JWT，不承载模型密钥，也不直接实现 Agent orchestration。
- OCR / 导入简历 / AI 解析继续留在现有体系，直到单独有迁移计划。

**退出条件:**

- 目录与部署方案可写成下一份实现 spec。
- 所有非目标已在文档中明确，避免后续把旧 AI 能力“顺手迁过去”。

### Phase 1 — Agent 上的富文本润色 MVP

**目标:** 以单个富文本润色按钮作为新增 Agent 能力的最小入口，验证 Web -> Agent 微服务 -> 模型流式输出 -> 编辑器落地的闭环。

**范围:**

- 用户在现有编辑器里选中或聚焦一段富文本内容，触发单次润色请求。
- 微服务负责 prompt 组装、模型调用、流式返回和安全兜底。
- Web 端继续掌管表单状态、撤销/确认写回、autosave 和 preview。

**明确不做:**

- 不做聊天式 UI。
- 不做跨 section 的全简历重写。
- 不做 OCR / 导入简历 / AI 解析复用或迁移。
- 不做长期记忆或复杂多工具工作流。

**退出条件:**

- MVP 行为边界清晰，可被单独测试和演示。
- 失败模式收敛：超时、provider error、JWT 过期、rate limit 都有明确 UI 与日志表现。

### Phase 2 — 增量简历级 Agent Helpers

**目标:** 在 Phase 1 成功后，扩展为面向简历不同模块的“增量 helper”能力，但仍保持非聊天、非全量托管。

**候选能力:**

- 针对 `summary`、`experience`、`projects` 等模块的定向建议。
- 基于当前 RHF / preview 数据生成“下一步建议”，但不接管整个简历生成。
- 更细粒度的 prompt 模板、tool calling 和结果结构化。

**边界:**

- 仍然是用户主导编辑，Agent 提供局部建议与增量修改。
- 不把整个 resume document 变成一个长会话 state machine。
- 仍不接入 `assistant-ui`。

**退出条件:**

- 已定义不同 helper 的接口模式、权限边界和 rate limit 策略。
- 能明确区分“局部按钮式 helper”与“聊天式 Agent”两类产品形态。

### Phase 3 — `assistant-ui` Agent Panel

**目标:** 在前两阶段稳定后，引入聊天式 Agent 面板，承载更持续的对话体验与可见的 streaming/tool calling 过程。

**范围:**

- `assistant-ui` 仅用于独立 Agent panel。
- 复用前面阶段沉淀的 JWT、streaming、memory、rate limit 与 observability 基础。
- 保持与单个润色按钮分层，不强行统一成交互同构。

**边界:**

- 不反向替代 Phase 1 的单次富文本润色入口。
- 不要求一开始就覆盖所有 helper 能力。

**退出条件:**

- 聊天面板与按钮式 helper 的职责分离清楚。
- memory / context 注入策略不破坏当前编辑器性能与数据一致性。

### Phase 4 — BYO Key / Credits / Rate Limits

**目标:** 在产品验证有效后，再补充面向商业化和自助配置的配额体系。

**范围:**

- 用户自带 key（BYO key）或平台 credits 的账户策略。
- Agent 微服务侧的 provider 选择、key routing、额度扣减、rate limit 分层。
- Web 端展示余额、额度、错误提示与升级入口。

**边界:**

- 不阻塞 Phase 1-3 的功能验证。
- 不把商业化约束提前耦进 MVP 的每条接口。

**退出条件:**

- 计费 / 配额模型与技术实现路径成文。
- 已明确哪些限制在 Web 层做，哪些在 Agent 微服务层做。

## 风险与提前约束

### 1. 边界漂移

最常见风险是把“已有 AI 能力”顺手并入新微服务，导致范围膨胀。后续每份 spec 都必须重复写明：OCR、导入简历、AI 解析不在本次迁移范围。

### 2. Web 端职责回流

如果 Web 端开始直接拼 prompt、持有 provider key 或实现复杂流式编排，就会破坏独立微服务的价值。必须保持 Web 端只做 auth、JWT、UI 和文档状态。

### 3. 2C4G 资源上限

香港 `2C4G` 主机对并发、Redis 共置、模型超时和日志体积都比较敏感。Phase 0 就要把资源预算写清楚，否则后面上线才会暴露瓶颈。

### 4. UI 形态混淆

单次润色按钮和聊天式 Agent panel 不是同一交互问题。若过早把两者统一，MVP 范围会迅速失控。

## 本次会话交付

- [x] 确认 Codex app 托管 worktree 的 cwd。
- [x] 确认当前 HEAD 位于 `main` 提交，并创建分支 `codex/ai-agent-microservice-managed`。
- [x] 写入本规划文档，明确 Phase 0-4 与边界约束。
- [x] 运行 `pnpm install` 作为依赖基线。
- [x] 运行 `pnpm test` 作为测试基线。

## 本次基线结果

- `pnpm install`: 成功。`Lockfile is up to date`，未引入新的 lockfile 变更；安装过程中出现 `msw@2.13.6` build script 被忽略的 pnpm 警告，但命令整体成功结束。
- `pnpm test`: 成功。Vitest 结果为 `54 passed` / `275 passed`，耗时约 `4.32s`。
- 当前 git 工作区仅新增本计划文件，未开始任何 Agent 功能代码实现。

## Phase 0A — 基础 Agent 服务骨架

**目标:** 在 `apps/agent` 新建独立 pnpm workspace package，提供可运行、可测试、可部署占位的 Node/TypeScript HTTP 服务，但不实现任何业务 Agent 能力。

**设计文档:** `docs/superpowers/specs/2026-06-05-agent-service-foundation-design.md`

**长期知识库:** `docs/agent/README.md`

**文件计划:**

- `apps/agent/package.json`: Agent 服务 package、dev/test/build/start 脚本。
- `apps/agent/tsconfig.json`: Node 服务专用 TypeScript 编译配置。
- `apps/agent/vitest.config.ts`: Agent 单测使用 node environment。
- `apps/agent/src/config.ts`: env 解析、默认值、端口校验。
- `apps/agent/src/http.ts`: `/health`、`/ready`、404、405 JSON 响应。
- `apps/agent/src/index.ts`: 启动服务、结构化启动日志、SIGTERM/SIGINT graceful shutdown。
- `apps/agent/tests/config.test.ts`: 配置默认值与非法端口测试。
- `apps/agent/tests/http.test.ts`: health/ready/404/405 HTTP 契约测试。
- `apps/agent/.env.example`: 本地与部署所需 env。
- `apps/agent/Dockerfile`: 生产镜像占位。
- `apps/agent/Caddyfile`: 香港服务器反代模板。
- `pnpm-workspace.yaml`: 纳入 `apps/*`。
- `package.json`: 增加 `agent:*` 脚本，并让根 `pnpm test` 跑 Agent 包测试。

**不做:**

- 不接 OpenAI / provider。
- 不接 Redis。
- 不验 JWT。
- 不新增 Web UI / API route。
- 不引入 `assistant-ui`。
- 不迁移 OCR、导入简历、AI 解析。

**退出条件:**

- `pnpm --filter @intro-builder/agent test` 通过。
- `pnpm test` 通过，并覆盖 Agent 包测试。
- `pnpm tsc --noEmit`、`pnpm lint`、`pnpm build` 通过。

**执行记录(2026-06-05):**

- 已创建 `apps/agent` 独立 workspace package，包名 `@intro-builder/agent`。
- 已实现 Node/TypeScript HTTP 基础服务：`GET /health`、`GET /ready`、JSON 404、JSON 405、env 配置解析、启动日志、SIGINT/SIGTERM shutdown。
- 已补 `Dockerfile`、`compose.yaml`、`Caddyfile`、`.env.example`。`compose.yaml` 预留 Redis 容器，但当前服务不连接 Redis。
- 已更新根 workspace 与脚本：`pnpm agent:dev`、`pnpm agent:start`、`pnpm agent:build`、`pnpm agent:test`、`pnpm agent:typecheck`；根 `pnpm test` 现在会串跑 Web 单测与 Agent 单测。
- 验证中发现 `/dev-preview` 在无 `DATABASE_URL` 的 `next build` 里发生构建期 DB 查询；已按 Next 16 route segment config 将该开发页标记为 `dynamic = "force-dynamic"`，恢复项目既定构建闸门。
- 验证通过：`pnpm verify`、`pnpm agent:build`。部署镜像使用 Node 22，符合项目 CI / runtime 约定。
- 手工冒烟通过：`AGENT_HOST=127.0.0.1 AGENT_PORT=8788 AGENT_VERSION=smoke-test pnpm --filter @intro-builder/agent start` 后请求 `GET /health` 返回 `200` 与预期 JSON。
- 已在香港服务器 `101.36.117.253` 安装 Docker Engine / Compose plugin，并以 `intro-deploy` 用户运行 `/opt/intro-agent` Compose stack：`agent`、`redis`、`caddy`。
- 已新增 `.github/workflows/deploy-agent.yml`，当 `main` 分支的 `apps/agent/**` 或相关 workspace / Docker / workflow 文件变更时，运行 `pnpm verify`、`pnpm agent:build`，再通过 SSH/rsync 部署到服务器。
- 已配置 GitHub Secrets：`AGENT_SSH_HOST`、`AGENT_SSH_PORT`、`AGENT_SSH_USER`、`AGENT_SSH_KEY`、`AGENT_SSH_KNOWN_HOSTS`；GitHub Variables：`AGENT_DEPLOY_PATH=/opt/intro-agent`、`AGENT_DOMAIN=api.rory-x.me`、`AGENT_PUBLIC_BASE_PATH=/intro-builder/agent`。
- 服务器内基础验证通过：`docker compose ps` 正常，Agent direct `/health` 正常。
- 原 `api.intro-builder.rory-x.me` 二级子域方案弃用，原因是 Cloudflare Universal SSL 默认不覆盖该层级，公网 TLS handshake 失败。
- 2026-06-06 决定改用一级子域 `api.rory-x.me`，并以 `/intro-builder/agent` 作为 Agent 公网路径前缀。
- 已验证远端 `.env`、GitHub Variables、Caddy adapted config 均指向 `api.rory-x.me` 与 `/intro-builder/agent`。
- Cloudflare 已添加 `api` A 记录，当前为 Proxied 状态；Caddy 已成功签发 `api.rory-x.me` 证书。
- 公网 HTTPS 已冒烟通过：`https://api.rory-x.me/intro-builder/agent/health` 与 `/ready` 均返回 `HTTP/2 200` JSON。若后续排查 origin，可临时切 DNS-only 直连 Caddy。
- 2026-06-06 复跑 `pnpm verify` 通过：lint 0 errors（保留既有 warnings）、Web 单测 54 files / 275 tests 通过、Agent 单测 2 files / 7 tests 通过、Next build 通过。

## 本地 Redis 调试环境

**执行记录(2026-06-05):**

- 开工前检查：本机没有 `redis-cli`、`redis-server`，也没有可用 `docker` 命令。
- 已通过 Homebrew 安装 `redis 8.8.0`。
- 已执行 `brew services start redis`，服务状态为 `started`，launch agent 位于 `~/Library/LaunchAgents/homebrew.mxcl.redis.plist`。
- 已验证 `redis-cli ping` 返回 `PONG`。
- 本地开发连接串：`redis://127.0.0.1:6379`。

## Phase 0B — Redis 与调用稳定性打通

**目标:** 在接入模型调用前，把 Agent 微服务的 Redis 连接、健康检查、基础 rate limit 与调用稳定性层打通。

**文件计划:**

- `apps/agent/package.json`: 增加 Redis client 依赖，优先选择具备稳定 reconnect 行为的 Node Redis 客户端。
- `apps/agent/src/redis.ts`: 创建 Redis client factory，支持 `REDIS_URL`、connect timeout、lazy connection、健康探测。
- `apps/agent/src/config.ts`: 增加 `redisUrl`、`redisConnectTimeoutMs`、`rateLimitWindowSeconds`、`rateLimitMaxRequests`。
- `apps/agent/src/http.ts`: 让 `/ready` 检查 Redis 可用性；`/health` 仍只表示进程存活，避免 Redis 短暂抖动导致进程被误杀。
- `apps/agent/src/rate-limit.ts`: 基于 Redis `INCR` + `EXPIRE` 实现最小 rate limit 原语，先用于后续受保护 API。
- `apps/agent/tests/redis.test.ts`: 用 fake Redis client 测连接成功、连接失败、ready 降级，不依赖真实本地 Redis。
- `apps/agent/tests/rate-limit.test.ts`: 覆盖窗口内计数、超过限制、窗口过期。
- `apps/agent/.env.example`: 打开 `REDIS_URL=redis://127.0.0.1:6379` 示例。
- `apps/agent/compose.yaml`: 保持 `redis` service，并让 agent 默认使用 `redis://redis:6379`。

**稳定性原则:**

- `/health` 不依赖 Redis；`/ready` 依赖 Redis。
- Redis 不可用时，Agent 应返回结构化 `dependency_unavailable`，而不是进程 crash。
- 对模型生成类请求不做盲目 retry；Redis 命令只在连接层做有限 reconnect。
- rate limit key 必须包含 scope 与 user identity，避免不同 Agent 能力互相挤占。

**退出条件:**

- `pnpm agent:test` 通过。
- `REDIS_URL=redis://127.0.0.1:6379 pnpm agent:dev` 后 `/ready` 返回 ready。
- 临时停掉 Redis 后 `/health` 仍返回 ok，`/ready` 返回非 ready 的结构化 JSON。
- `pnpm verify` 与 `pnpm agent:build` 通过。

**执行记录(2026-06-07):**

- 已新增 `redis` runtime dependency，并更新 Agent Docker runner 为 scoped production install，避免镜像运行时缺少 Redis client。
- 已实现 `apps/agent/src/redis.ts`：Redis client factory、lazy connect、`PING` readiness、shutdown cleanup。
- 已实现 `apps/agent/src/rate-limit.ts`：Redis `INCR` + `EXPIRE` 窗口限流 primitive，key 形状为 `rate:{scope}:{identityHash}:{windowStart}`。
- 已实现 `apps/agent/src/errors.ts` 与 HTTP request id：所有错误响应包含 `requestId`，并通过 `X-Request-Id` 响应头透传。
- `/health` 保持进程存活检查，不依赖 Redis；`/ready` 现在依赖 Redis，Redis 不可用时返回 `503 dependency_unavailable`。
- TDD 中发现 node-redis 在 Redis 不可达时会持续 reconnect，导致 `/ready` 请求悬挂；已为 readiness probe 增加硬超时，超时后断开 Redis client 并返回结构化 not-ready。
- 本地真实 Redis smoke 通过：`/health` 返回 `200`，`/ready` 返回 `200` 且包含 `dependencies.redis=ready`。
- 本地 Redis-down smoke 使用不可达 `REDIS_URL=redis://127.0.0.1:6390` 验证通过：`/health` 返回 `200`，`/ready` 返回 `503 dependency_unavailable`，并透传 `x-request-id`。
- 服务器临时 Docker build 验证通过：使用当前 worktree 同步到 `/tmp/intro-agent-phase0b-build` 构建 `intro-agent:phase0b-build-check`，再以一次性容器接入 `agent_default` network，`/health` 与 `/ready` 均返回 `200`；临时镜像与临时目录已清理，线上 compose 容器未重启。

## Phase 0C — Web-to-Agent Auth 与调用客户端

**目标:** 在接入模型调用前，先打通 Web -> Agent 的短期 JWT、Agent 验签、Redis `jti` replay guard 和最小受保护 smoke endpoint，证明服务间调用边界稳定。

**文件计划:**

- `apps/agent/src/auth.ts`: 校验 Agent JWT 的 `iss`、`aud`、`exp`、`sub`、`scope` 与 `jti`，并通过 Redis `SET NX EX` 做 replay guard。
- `apps/agent/src/config.ts`: 增加 `AGENT_JWT_ISSUER`、`AGENT_JWT_AUDIENCE`、`AGENT_JWT_SECRET`、`AGENT_JWT_REPLAY_TTL_SECONDS`。
- `apps/agent/src/http.ts`: 新增 `GET /v1/session`，只接受 `agent:session` scope，用于验证认证链路。
- `apps/agent/tests/auth.test.ts`: 覆盖有效 token、缺失 token、过期 token、错误 issuer / audience / scope、重复 `jti`。
- `apps/agent/tests/http.test.ts`: 覆盖 protected route 的成功与认证失败响应。
- `lib/agent/token.ts`: Web server-only 短期 Agent JWT signer。
- `lib/agent/client.ts`: Web server-only Agent HTTP client，统一 base URL、request id、timeout 和错误映射。
- `tests/unit/agent-token.test.ts`: 覆盖 signer claims、TTL、scope、resumeId。
- `tests/unit/agent-client.test.ts`: 覆盖 request id 传递、timeout、错误 envelope。
- `app/api/agent/session/route.ts`: 最小 Web BFF smoke route，验证 Web 已登录后签发 `agent:session` token 并调用 Agent `/v1/session`。

**明确不做:**

- 不实现 provider / OpenAI / DeepSeek 模型调用。
- 不实现富文本润色、streaming、tool calling。
- 不改编辑器 UI、RHF、preview、autosave。
- 不引入 `assistant-ui`。
- 不迁移 OCR、导入简历、AI 解析。

**安全原则:**

- Agent 不信任浏览器 cookie，只信任 Web 签发的短期 JWT。
- Web 在真实业务能力里必须先校验 resume ownership，再签发包含 `resumeId` 的能力 token；本阶段 smoke scope 为 `agent:session`，不授予简历修改能力。
- 受保护 Agent route 在 Redis replay guard 不可用时 fail closed。
- 所有认证失败继续使用 JSON error envelope，并透传 `X-Request-Id`。

**退出条件:**

- `pnpm agent:test` 通过。
- `pnpm test` 通过。
- `pnpm tsc --noEmit`、`pnpm lint`、`pnpm build` 通过或记录明确阻塞。
- 本地可用 Redis 时，Web BFF smoke route 能通过 Agent `/v1/session`；重放同一 token 会被拒绝。

## 后续建议

1. 用户确认本规划后，先补一份对应 spec，专门收敛 Phase 0 的微服务技术选型、部署拓扑、JWT 契约和 Redis 切分。
2. spec 批准后，再为 Phase 0 或 Phase 1 单独写实现 plan，不把五个阶段一次性揉成一个可执行开发任务。
3. 真正开始实现前，再检查 Next.js 16 相关文档与现有 AI 代码入口，避免在错误位置落 Agent 集成。
