# intro-builder Agent Knowledge Base

这是 intro-builder 新增 Agent 微服务的开发知识库。它面向后续接手的工程师和 Agent worker，说明为什么要拆独立服务、当前做到哪里、下一步如何稳妥推进。

## 当前状态

- 当前规划分支：`codex/agent-phase-3-assistant-ui-design`
- 微服务目录：`apps/agent`
- 当前能力：基础 Node/TypeScript HTTP 服务，包含 `/health`、Redis-backed `/ready`、protected `/v1/session`、`POST /v1/rich-text/polish`、`POST /v1/resume/helpers/:helperId`、`POST /v1/agent/messages`、JSON 404/405、统一错误 envelope、request id、Redis readiness、rate limit primitive、短期 Agent JWT 校验、Redis `jti` replay guard、STAR-aware prompt、OpenAI-compatible provider 配置、配置解析、启动日志、Docker/Caddy/compose。
- Phase 2A 能力：`resume-diagnose` 提供整份简历诊断，`section-next-steps` 提供单个模块下一步建议。Web BFF 为 `POST /api/agent/resume/helpers/[helperId]`，会校验 Auth.js session 与 resume ownership 后签发 `resume:helper` JWT。
- Phase 2A UI：编辑器顶部有 `AI 诊断` 入口，工作经历、项目经历、教育经历、研究经历、技能、自定义模块 header 有 `AI 建议` 入口。按钮使用文字与图标渐变，不使用渐变背景。
- Phase 3A 规划：已确认 A 方案 `Agent Mode replaces left editor`。点击 `Agent 模式` 后左侧编辑列切换为 assistant-ui Agent panel，右侧 `LivePreview` 保持可见。当前分支已落地 shared message contract、chat context、Agent service message/tool contract、Agent `/v1/agent/messages` route 和 Web BFF `/api/agent/messages`；下一步继续补 assistant-ui runtime 与左侧 Agent panel UI。
- 本地 Redis：已安装并启动 Homebrew `redis 8.8.0`，连接串为 `redis://127.0.0.1:6379`。
- 服务器部署：`101.36.117.253` 已安装 Docker/Compose，`/opt/intro-agent` 已运行 `agent + redis + caddy`。公网入口 `https://api.rory-x.me/intro-builder/agent` 已通过 Cloudflare -> Caddy -> Agent 的 `/health` 与 `/ready` 冒烟。
- 当前生产不包含：Phase 3A assistant-ui Agent Mode、Web BFF `/api/agent/messages`、可确认写回的 `ResumePatch` UI。

## Phase 3A 设计锚点

后续实现只要碰 Agent Mode，都必须和这些锚点一致：

- 桌面采用 A 方案：`Agent 模式` 替换左侧编辑列，不做右侧 drawer，不遮挡右侧 `LivePreview`。
- Phase 3A 先走 JSON message contract：Browser -> Web BFF `/api/agent/messages` -> Agent `/v1/agent/messages`。DataStream/SSE 升级属于 Phase 3B。
- assistant-ui 只负责 thread、composer、tool display；不能拥有 RHF、autosave、模板或 preview 状态。
- 基础 tools 是 Agent 推理工具，只能返回 `ResumePatch`，不能直接写 RHF/Postgres。
- 用户点击 `应用` 前，任何 Agent 输出都不能改变简历内容；点击后也必须走 Web allowlist dispatcher、RHF `setValue` 和 `resume:flush-autosave`。
- 富文本 patch 必须保持 TipTap JSON 语义；原文是有序/无序列表时，润色结果仍必须是列表结构。
- 现有 OCR、导入简历、AI 解析不迁移到这个 Agent 微服务。

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
- [service-contracts.md](./service-contracts.md): HTTP API、JWT claims、错误格式、JSON message contract 和未来 streaming 约束。
- [security-and-stability.md](./security-and-stability.md): auth、rate limit、timeout、observability、部署稳定性检查清单。
- [deployment.md](./deployment.md): 香港服务器、Docker Compose、GitHub Actions、DNS/Cloudflare 状态与运维命令。
- [code-map.md](./code-map.md): Agent 服务、Web client、编辑器、富文本、测试入口地图。
- [development.md](./development.md): 本地开发、Redis、命令、验证闸门。
- [assistant-ui-research.md](./assistant-ui-research.md): assistant-ui 调研、适配结论、Phase 3 接入策略。
- [frontend-integration.md](./frontend-integration.md): 复用现有编辑器页面表现、RHF/autosave 边界、Agent UI 入口。
- [implementation-roadmap.md](./implementation-roadmap.md): Phase 0B 到 Phase 4 的实现路线。

## 权威来源

- 当前工作计划：[docs/superpowers/plans/2026-06-05-ai-agent-work-plan.md](../superpowers/plans/2026-06-05-ai-agent-work-plan.md)
- Phase 2A 实施计划：[docs/superpowers/plans/2026-06-08-agent-resume-helpers-phase-2a.md](../superpowers/plans/2026-06-08-agent-resume-helpers-phase-2a.md)
- Phase 3A 设计：[docs/superpowers/specs/2026-06-09-agent-mode-assistant-ui-design.md](../superpowers/specs/2026-06-09-agent-mode-assistant-ui-design.md)
- Phase 3A 实施计划：[docs/superpowers/plans/2026-06-09-agent-mode-assistant-ui-phase-3a.md](../superpowers/plans/2026-06-09-agent-mode-assistant-ui-phase-3a.md)
- 基础服务设计：[docs/superpowers/specs/2026-06-05-agent-service-foundation-design.md](../superpowers/specs/2026-06-05-agent-service-foundation-design.md)
- 当前服务代码：[apps/agent](../../apps/agent)

## 修改规则

- Agent 相关架构知识优先更新本目录，再同步到对应 plan/spec。
- 每新增一个 Agent 能力，都要在 `service-contracts.md` 写清 API、auth、错误、rate limit。
- 每新增一个运行依赖，都要在 `development.md` 写清本地调试和生产部署差异。
- 每次实现一个 phase，都要在 `implementation-roadmap.md` 标记实际结果和验证命令。
