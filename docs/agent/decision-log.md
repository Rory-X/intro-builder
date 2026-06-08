# Agent Decision Log

本文档记录 Agent 微服务相关的关键决策。后续如果现实证伪某个决定，请在同一个 PR 里更新这里。

## D1: 新增 Agent 能力部署到独立微服务

Decision: 新增 Agent 能力部署到 `apps/agent` 独立服务，不继续放进 Next.js Web app。

Why:

- Agent 能力会涉及 streaming、tool calling、provider timeout、Redis memory/rate limit，更像后端服务而不是页面 route。
- 香港 2C4G 服务器已经购买一年，适合作为独立 Agent runtime。
- Web app 应保持编辑器、preview、autosave 的稳定性，避免模型调用影响主站请求。

Consequences:

- 需要 Web -> Agent 调用契约。
- 需要短期 Agent JWT。
- 需要独立部署、日志、健康检查。
- 需要明确哪些 AI 能力不迁移。

## D2: 现有 OCR、导入简历、AI 解析不迁移

Decision: 已上线的 OCR、导入简历、AI 解析不进入本次 Agent 微服务范围。

Why:

- 它们属于基础 AI 辅助能力，已经有线上路径。
- 本次目标是新增 Agent 能力，不做历史能力搬家。
- 同时迁移旧能力会扩大回归面，影响简历导入主流程。

Consequences:

- Agent 微服务只承接新增能力。
- 每个新 plan 都要重复写明这个边界。
- 未来若要迁移 OCR/导入/解析，需要单独 spec、数据流和回滚方案。

## D3: Phase 1 不使用 assistant-ui

Decision: 单个富文本润色按钮不使用 assistant-ui。

Why:

- 富文本润色是短链路按钮式交互。
- assistant-ui 的价值在多轮 thread、composer、tool display、chat runtime。
- 过早引入会让 MVP 同时处理聊天状态、stream protocol、tool UI、bundle 体积。

Consequences:

- Phase 1 使用轻量 `RichTextEditor` toolbar button + suggestion UI。
- assistant-ui 放到 Phase 3 Agent panel。
- Phase 1 仍可沉淀 stream/error/auth/rate limit，为 Phase 3 复用。

## D4: Web 保留最终写入权

Decision: Agent 服务只返回 suggestion，不直接写 Postgres。

Why:

- Web 当前掌管 React Hook Form、preview、autosave。
- 用户必须确认 AI 输出是否写回。
- 保持 Agent 服务无 DB 写入权可以降低安全风险。

Consequences:

- Agent 输出要结构化，能被 Web UI 展示和确认。
- Web 侧要有 apply/cancel UI。
- 保存仍走现有 autosave 队列。

## D5: `/health` 与 `/ready` 分离

Decision: `/health` 表示进程存活；`/ready` 表示依赖可用。

Why:

- Redis 或 provider 短暂不可用时，不应该让进程被误判为死亡。
- 部署平台、Caddy、监控和人工排查需要不同粒度的信号。

Consequences:

- Phase 0A `/health` 和 `/ready` 都返回成功。
- Phase 0B 后 `/ready` 检查 Redis。
- 模型 provider 不一定进入 `/ready`，除非后续确认 provider 是硬依赖。

## D6: Node 内置 HTTP 作为基础骨架

Decision: 当前基础服务使用 Node 内置 `http`，暂不引入 Fastify/Hono。

Why:

- Phase 0A 只需要健康检查、配置和进程生命周期。
- 暂不引入依赖可降低初始复杂度。
- 后续如果 streaming、middleware、route schema 复杂度上升，再基于证据换框架。

Consequences:

- 当前路由很轻。
- Phase 0B/0C 需要注意不要在 `http.ts` 堆太多逻辑。
- 当 route 数量超过 3 到 5 个，应该重新评估路由层抽象。

## D7: Redis 先承担稳定性职责

Decision: Redis 先用于 rate limit、jti replay guard、短期 memory，不作为永久业务数据库。

Why:

- Redis 适合短期状态、计数、TTL。
- 简历内容真源仍是 Postgres 和 Web autosave。
- 香港 2C4G 资源有限，Redis 使用要克制。

Consequences:

- Redis key 必须有 TTL。
- Redis 不存完整简历正文作为长期 memory。
- `/ready` 检查 Redis，但 `/health` 不检查。

## D8: Web BFF 优先代理 assistant-ui Agent messages

Decision: Phase 3A 首版 Agent panel 优先走 `Browser -> Next /api/agent/messages -> Agent /v1/agent/messages` 的 JSON message contract；streaming/DataStream 升级延后到 Phase 3B。

Why:

- 复用 Auth.js cookie。
- Web server 可以签发短期 Agent JWT。
- 避免首版处理 CORS、public Agent token endpoint、浏览器直连策略。

Consequences:

- Phase 3A 先验证 message、tool call、`ResumePatch` 和确认写回语义，不把协议稳定性和 UI 状态复杂度同时放大。
- 如果 BFF 或 JSON contract 后续成为瓶颈，可以升级为 Web streaming BFF 或 browser -> Agent direct + short-lived token。
- assistant-ui runtime 不直接知道 Agent 内部部署地址。

## D9: `/dev-preview` 标记为动态渲染

Decision: `app/dev-preview/page.tsx` 加 `export const dynamic = "force-dynamic"`。

Why:

- 该页面查询模板 DB，不应在无 `DATABASE_URL` 的 `next build` 里静态预渲染。
- 项目已有构建期 placeholder DATABASE_URL 策略，目标是导入时 fail-soft，不是在 build 里触发实际查询。

Consequences:

- `pnpm build` 在无 `.env.local` 时可以继续通过。
- `/dev-preview` 作为开发 DB 页面按请求渲染。

## D10: Phase 3A Agent Mode 替换左侧编辑列

Decision: Phase 3A 采用 **Agent Mode replaces left editor**。用户点击编辑器 toolbar 的 `Agent 模式` 后，左侧编辑列切换为 assistant-ui Agent panel，右侧 `LivePreview` 保持可见。

Why:

- 简历优化需要边聊边看预览，右侧 drawer 会压缩 preview，削弱核心排版反馈。
- 左侧编辑列是用户“修改简历”的工作区域，切换成 Agent panel 更像一个明确模式，而不是泛用客服聊天气泡。
- 首版可以保留 Web 的 RHF、autosave、preview 真源，同时验证 Agent 工作流和工具调用。

Consequences:

- Phase 3A 不做右侧 Sheet/side panel。
- 移动端 Agent panel 延后到 Phase 3B，再评估 `Sheet`。
- Template panel 与 Agent panel 互斥。
- Agent Mode 切换不得重置 RHF state、section order、模板选择或 autosave 队列。

## D11: Phase 3A tools 只返回 ResumePatch

Decision: Phase 3A 必须封装基础简历修改 tools 供 Agent 推理调用，但 tools 只能返回 `ResumePatch`，不能直接保存或改写简历。

Initial tools:

- `inspect_resume`
- `propose_rich_text_rewrite`
- `propose_summary_rewrite`
- `propose_bullet_rewrite`
- `draft_section_item`

Why:

- 用户需要看到 Agent 不只是聊天，而是在使用可解释的简历工具推理。
- 直接写 RHF 或 Postgres 会破坏用户确认、安全边界和 autosave 队列。
- `ResumePatch` 可以让 Web 在确认卡里展示差异、风险和 `应用` / `忽略`。

Consequences:

- Web 是唯一写回执行者。
- Agent provider 输出必须经过 allowlist 和 schema 校验。
- 富文本 patch 必须保持 TipTap 语义；列表输入不能被润色成一段无结构文本。
- STAR 优化不得编造 Result 指标，缺事实时必须返回 `needs_user_fact`。
