# intro-builder Agent Knowledge Base

这是 intro-builder 新增 Agent 微服务的开发知识库。它面向后续接手的工程师和 Agent worker，说明为什么要拆独立服务、当前做到哪里、下一步如何稳妥推进。

## 当前状态

- 分支：`codex/agent-rich-text-polish`
- 微服务目录：`apps/agent`
- 当前能力：基础 Node/TypeScript HTTP 服务，包含 `/health`、Redis-backed `/ready`、protected `/v1/session`、`POST /v1/rich-text/polish`、JSON 404/405、统一错误 envelope、request id、Redis readiness、rate limit primitive、短期 Agent JWT 校验、Redis `jti` replay guard、STAR-aware prompt、OpenAI-compatible provider 配置、配置解析、启动日志、Docker/Caddy/compose。
- 本地 Redis：已安装并启动 Homebrew `redis 8.8.0`，连接串为 `redis://127.0.0.1:6379`。
- 服务器部署：`101.36.117.253` 已安装 Docker/Compose，`/opt/intro-agent` 已运行 `agent + redis + caddy`。公网入口 `https://api.rory-x.me/intro-builder/agent` 已通过 Cloudflare -> Caddy -> Agent 的 `/health` 与 `/ready` 冒烟。
- 当前不包含：streaming、tool calling、编辑器按钮 UI、自动写回、assistant-ui。

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
- [service-contracts.md](./service-contracts.md): HTTP API、JWT claims、错误格式、streaming contract。
- [security-and-stability.md](./security-and-stability.md): auth、rate limit、timeout、observability、部署稳定性检查清单。
- [deployment.md](./deployment.md): 香港服务器、Docker Compose、GitHub Actions、DNS/Cloudflare 状态与运维命令。
- [code-map.md](./code-map.md): Agent 服务、Web client、编辑器、富文本、测试入口地图。
- [development.md](./development.md): 本地开发、Redis、命令、验证闸门。
- [assistant-ui-research.md](./assistant-ui-research.md): assistant-ui 调研、适配结论、Phase 3 接入策略。
- [frontend-integration.md](./frontend-integration.md): 复用现有编辑器页面表现、RHF/autosave 边界、Agent UI 入口。
- [implementation-roadmap.md](./implementation-roadmap.md): Phase 0B 到 Phase 4 的实现路线。

## 权威来源

- 当前工作计划：[docs/superpowers/plans/2026-06-05-ai-agent-work-plan.md](../superpowers/plans/2026-06-05-ai-agent-work-plan.md)
- 基础服务设计：[docs/superpowers/specs/2026-06-05-agent-service-foundation-design.md](../superpowers/specs/2026-06-05-agent-service-foundation-design.md)
- 当前服务代码：[apps/agent](../../apps/agent)

## 修改规则

- Agent 相关架构知识优先更新本目录，再同步到对应 plan/spec。
- 每新增一个 Agent 能力，都要在 `service-contracts.md` 写清 API、auth、错误、rate limit。
- 每新增一个运行依赖，都要在 `development.md` 写清本地调试和生产部署差异。
- 每次实现一个 phase，都要在 `implementation-roadmap.md` 标记实际结果和验证命令。
