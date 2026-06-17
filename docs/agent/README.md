# intro-builder Agent Knowledge Base

这是 intro-builder 新增 Agent 微服务的开发知识库。它面向后续接手的工程师和 Agent worker，说明为什么要拆独立服务、当前做到哪里、下一步如何稳妥推进。

## 当前状态

- 当前落地状态：Phase 3B 已通过 PR #43 合入 `main`，并已部署到 Web 与 Agent 生产链路。
- 微服务目录：`apps/agent`
- 当前能力：基础 Node/TypeScript HTTP 服务，包含 `/health`、Redis-backed `/ready`、protected `/v1/session`、`POST /v1/rich-text/polish`、`POST /v1/resume/helpers/:helperId`、`POST /v1/agent/messages`、JSON 404/405、统一错误 envelope、request id、Redis readiness、rate limit primitive、短期 Agent JWT 校验、Redis `jti` replay guard、STAR-aware prompt、Agent Mode AI SDK provider、Langfuse Prompt Management fallback、配置解析、启动日志、Docker/Caddy/compose。
- Phase 2A 能力：`resume-diagnose` 提供整份简历诊断，`section-next-steps` 提供单个模块下一步建议。Web BFF 为 `POST /api/agent/resume/helpers/[helperId]`，会校验 Auth.js session 与 resume ownership 后签发 `resume:helper` JWT。
- Phase 2A UI：编辑器顶部有 `AI 诊断` 入口，工作经历、项目经历、教育经历、研究经历、技能、自定义模块 header 有 `AI 建议` 入口。按钮使用文字与图标渐变，不使用渐变背景。
- Phase 3B 能力：在 Phase 3A 左侧 Agent Mode 基础上，Agent `/v1/agent/messages` 与 Web BFF `/api/agent/messages` 已升级为 AG-UI `text/event-stream`。assistant-ui 继续使用 `LocalRuntime` + custom adapter，但 adapter 返回 async generator，逐步消费 AG-UI `TEXT_MESSAGE_CONTENT`，并从 `TOOL_CALL_RESULT` 渲染 tool card 与确认卡。
- Phase 3C 能力：Agent SSE cache hit 不再返回 JSON；SSE provider/parse failure 会返回 AG-UI `RUN_ERROR`；Web stream 不再被 10 秒 JSON timeout 误杀；Agent Mode 通过 AI SDK openai-compatible adapter 支持 streaming，并从 provider JSON 的 `message.content` 安全提取可见增量；Web 新增 SDK-compatible `/api/agent/runs`，接收 AG-UI `RunAgentInput` 并通过 `forwardedProps.introBuilder` 映射到现有 Agent request。
- Phase 3B follow-up：Agent 对话输出允许 provider 在纯追问/澄清轮次省略空 `toolCalls` 和 `proposedOperations`，服务端会归一化为 `[]`；AG-UI 文本事件会拆成多段 delta，并在 assistant-ui 首段到达前显示 `AI 正在思考` 等待态。Web 错误卡会展示 `code` 与 `requestId`，方便排查线上 provider、JWT 或依赖问题。
- 本地 Redis：已安装并启动 Homebrew `redis 8.8.0`，连接串为 `redis://127.0.0.1:6379`。
- 服务器部署：`101.36.117.253` 已安装 Docker/Compose，`/opt/intro-agent` 已运行 `agent + redis + caddy`。公网入口 `https://api.rory-x.me/intro-builder/agent` 已通过 Cloudflare -> Caddy -> Agent 的 `/health` 与 `/ready` 冒烟，当前 Agent 生产版本为 `github-c36362c33239`。
- 当前生产包含：Phase 3B assistant-ui Agent Mode、AG-UI streaming、移动端 Agent Sheet，以及可确认写回的 `ResumeOperation` UI。Web 生产部署、Agent CD 和公网 Agent `/health`/`/ready` 已在 2026-06-09 验证通过。

## Phase 3 Agent Mode 设计锚点

后续实现只要碰 Agent Mode，都必须和这些锚点一致：

- 如果实现、测试或文档与本节冲突，先回到 Phase 3A/3B spec/plan 修正，不要用局部实现反向改变产品形态。
- 桌面采用 A 方案：`Agent 模式` 替换左侧编辑列，不做右侧 drawer，不遮挡右侧 `LivePreview`。
- Browser -> Web BFF `/api/agent/runs` -> Agent `/v1/agent/messages` 是 Agent panel 的当前产品调用路径；`/api/agent/messages` 保留为旧 contract 兼容、服务端测试和 debug fallback。浏览器仍不能直连 Agent `/v1/agent/messages`。
- assistant-ui 只负责 thread、composer、tool display；不能拥有 RHF、autosave、模板或 preview 状态。
- 基础 tools 固定为 `resume_read`、`resume_update_section`、`resume_delete_section`、`resume_reorder_sections`、`resume_insert_section`；它们是最小简历能力集合，只能返回待确认 `ResumeOperation`，不能直接写 RHF/Postgres。
- 不新增 prompt-specific tool 名称。`inspect_resume`、`propose_*`、`draft_section_item` 等历史草案名不得进入实现、prompt、测试或 UI，除非先更新 `docs/agent/service-contracts.md`、proto 草案和 Web confirmation 语义。
- 用户点击 `应用` 前，任何 Agent 输出都不能改变简历内容；点击后也必须走 Web allowlist dispatcher、RHF `setValue` 和 `resume:flush-autosave`。
- 富文本 `update_section` 必须保持 TipTap JSON 语义；原文是有序/无序列表时，润色结果仍必须是列表结构。
- 现有 OCR、导入简历、AI 解析不迁移到这个 Agent 微服务。

## 防偏离检查清单

进入后续 Agent Mode 开发前，先确认：

- `Agent 模式` 是左侧编辑列模式切换，不是右侧抽屉、浮窗聊天或全屏 Agent workspace。
- 右侧 `LivePreview` 在桌面 Agent Mode 中始终可见，并且只由 RHF 驱动。
- Web BFF 仍是浏览器到 Agent 的唯一入口；浏览器不直连 Agent `/v1/agent/messages`。
- Agent 返回的是 AG-UI lifecycle/text/tool events；真正写回只能发生在 Web 的确认卡回调里。
- 对话流相关实现必须优先使用 `@ag-ui/core` 类型和 `@ag-ui/encoder` 编码，不能自定义一套平行事件协议。
- SDK-compatible UI 入口必须使用 AG-UI `RunAgentInput`，并把 Web-owned `resumeId`、`workflowId`、RHF capped context 放进 `forwardedProps.introBuilder` 或 `forwardedProps.runConfig.introBuilder`。
- Phase 3B 已包含 assistant-ui streaming adapter 与移动端 Agent Sheet；旧 OCR、导入简历、AI 解析仍不迁移。

## 产品边界

本次 Agent 微服务只承载新增 Agent 能力。已经上线的 OCR、导入简历、AI 解析属于现有基础 AI 辅助能力，不迁移、不重写、不纳入本次服务边界。

Web 主站继续负责：

- Auth.js 登录态与用户身份。
- 短期 Agent JWT 签发。
- 编辑器 UI 与 React Hook Form 状态。
- 实时 preview 与 autosave。
- PDF、模板、分享等既有产品能力。

Agent 微服务逐步负责：

- 新增 Agent 模型调用。
- prompt 与输出结构化。
- streaming 与取消。
- tool calling。
- Redis memory、rate limit、jti replay guard。
- Docker/Caddy 部署与服务观测。

## 文档地图

- [architecture.md](./architecture.md): 技术架构、服务边界、部署拓扑、稳定性原则。
- [decision-log.md](./decision-log.md): 微服务、assistant-ui、Redis、写回权等关键决策记录。
- [service-contracts.md](./service-contracts.md): HTTP API、JWT claims、错误格式、AG-UI message stream 和 resume operation 约束。
- [security-and-stability.md](./security-and-stability.md): auth、rate limit、timeout、observability、部署稳定性检查清单。
- [observability-and-evals.md](./observability-and-evals.md): Langfuse tracing、Prompt Management、隐私边界、offline eval 与 dataset experiment 命令。
- [deployment.md](./deployment.md): 香港服务器、Docker Compose、GitHub Actions、DNS/Cloudflare 状态与运维命令。
- [code-map.md](./code-map.md): Agent 服务、Web client、编辑器、富文本、测试入口地图。
- [development.md](./development.md): 本地开发、Redis、命令、验证闸门。
- [assistant-ui-research.md](./assistant-ui-research.md): assistant-ui 调研、适配结论、Phase 3 接入策略。
- [frontend-integration.md](./frontend-integration.md): 复用现有编辑器页面表现、RHF/autosave 边界、Agent UI 入口。
- [fogot-inspired-long-loop-agent.md](./fogot-inspired-long-loop-agent.md): 从 Fogot agent panel 提炼的长 loop、多轮 tool call、工具轨迹和简历领域 Agent 优化方向。
- [implementation-roadmap.md](./implementation-roadmap.md): Phase 0B 到 Phase 4 的实现路线。

## 权威来源

- 当前工作计划：[docs/superpowers/plans/2026-06-05-ai-agent-work-plan.md](../superpowers/plans/2026-06-05-ai-agent-work-plan.md)
- Phase 2A 实施计划：[docs/superpowers/plans/2026-06-08-agent-resume-helpers-phase-2a.md](../superpowers/plans/2026-06-08-agent-resume-helpers-phase-2a.md)
- Phase 3A 设计：[docs/superpowers/specs/2026-06-09-agent-mode-assistant-ui-design.md](../superpowers/specs/2026-06-09-agent-mode-assistant-ui-design.md)
- Phase 3A 实施计划：[docs/superpowers/plans/2026-06-09-agent-mode-assistant-ui-phase-3a.md](../superpowers/plans/2026-06-09-agent-mode-assistant-ui-phase-3a.md)
- Phase 3B AG-UI 设计：[docs/superpowers/specs/2026-06-09-agent-mode-streaming-phase-3b-design.md](../superpowers/specs/2026-06-09-agent-mode-streaming-phase-3b-design.md)
- Phase 3B AG-UI 实施计划：[docs/superpowers/plans/2026-06-09-agent-mode-streaming-phase-3b.md](../superpowers/plans/2026-06-09-agent-mode-streaming-phase-3b.md)
- 基础服务设计：[docs/superpowers/specs/2026-06-05-agent-service-foundation-design.md](../superpowers/specs/2026-06-05-agent-service-foundation-design.md)
- 当前服务代码：[apps/agent](../../apps/agent)

## 修改规则

- Agent 相关架构知识优先更新本目录，再同步到对应 plan/spec。
- 每新增一个 Agent 能力，都要在 `service-contracts.md` 写清 API、auth、错误、rate limit。
- 每新增一个运行依赖，都要在 `development.md` 写清本地调试和生产部署差异。
- 每次实现一个 phase，都要在 `implementation-roadmap.md` 标记实际结果和验证命令。
