# Spec: Agent 服务 Hono + AI SDK 重构（two-endpoint, preview/apply, ask）

- 日期：2026-06-15
- 状态：草拟中（待落地）
- 作者：intro-builder agent
- 相关：[decision-log](../../agent/decision-log.md)、[PR #80 真 loop](./2026-06-15-agent-loop-execution-design.md)

## 1. 背景与目标（用户直述）

现状 `apps/agent` 用手写 Node `http`（`http.ts` 1637 行）承载所有 AI 能力，路由、SSE 编码、
AG-UI 事件契约（`agent-messages.ts` 1525 行 + `agent-tools.ts` 380 行的 JSON 契约校验）堆在一起，
被判定「太重」。本次目标（用户拍板，prescriptive）：

1. **用 Hono 重构 agent server**，并保证 CD（`Dockerfile` + `deploy-agent.yml`）正常。
2. **AI agent 能力只保留两个接口**：
   - `session`：开对话，会话**存远程数据库（Postgres）**。
   - `chat`：对话流（SSE），**流标准按 Agent SDK（Vercel AI SDK v6）**。
3. **assistant-ui 直接用 Agent SDK（AI SDK）的 UI 组件方案**；**AG-UI 只作能力加强**（自定义 data part），不再是核心契约。
4. **每个 tool 都不直接落库到个人简历**：tool 写操作只产出一个 **preview 简历**；用户可在同一 session
   **循环继续修改 preview**，或**选择应用**——**这时才落到个人简历数据库**。
5. **tool 可以只读所有生产数据库的数据**（read-only）。
6. 新增 **ask 功能**：信息不足或提示词引导时，弹 **ask 面板**让用户补充信息。
7. **核心 SSE 流事件按 SDK 标准**。
8. 上述功能必须**全部落地到 web 侧**才算完成。

## 2. 关键事实（已核验）

- 已装版本：`ai@6.0.204`、`@ai-sdk/openai-compatible@2.0.50`、`hono@4.12.15`（已在 store）、
  `@assistant-ui/react@0.14.15`、`@assistant-ui/react-ag-ui@0.0.36`。
- **AI SDK v6 原生提供**全部所需原语：`streamText().toUIMessageStreamResponse()`、
  UI message stream 的 SSE 协议头 `x-vercel-ai-ui-message-stream`、`tool()` / `stepCountIs()`、
  工具审批（`needsApproval` / `ToolApprovalRequestOutput` / `addToolResult`）、自定义 `data-*` part、
  `ToolLoopAgent`（导出名 `Experimental_Agent`）、`convertToModelMessages`。
- **assistant-ui 0.14.15 主包**已导出 `useChatRuntime`、`AssistantChatTransport`、
  `useDataStreamRuntime`、`makeAssistantToolUI`、`useAssistantTool`、`AssistantRuntimeProvider`
  —— AI SDK UI message stream 集成内置，**无需新增 assistant-ui 包**。
- **agent 当前没有 Postgres 依赖**：session 现在走 Redis（`createRedisAgentSessionStore`，30 天 TTL）。
  Postgres 表 `agent_session` / `agent_session_event`（migration 0011，已在 main）存在但 agent 未写。
- DB schema：`resumes.content` 是 `jsonb<ResumeContent>`；`agent_session.stateJson` 是
  `jsonb<AgentSessionSnapshot>`；`agent_session_event` 有 `(runId, sequence)` 唯一索引。
- Web BFF 既有模式（`app/api/agent/runs/route.ts`）：`auth()` → 在 web DB 校验简历归属 →
  `signAgentToken({scope})` → 透传 agent 的 SSE。`maxDuration=120`、`runtime=nodejs`。

## 3. 决策与歧义裁定（延续 decision-log 编号）

- **D12：agent 能力收敛为两个端点 `POST /v1/agent/session` + `POST /v1/agent/chat`。**
  旧的 `/v1/agent/messages`（AG-UI JSON/SSE 契约）下线；`agent-messages.ts` / `agent-tools.ts` 的
  「让模型吐 JSON 再手写校验」契约层随之删除。
- **D13：`apply`（preview→真简历）不是 agent 端点，放在 Web 侧。** 落库权仍归 Web（沿用
  decision-log D4）。因此 agent 严格只有两个 agent 端点。
- **D14：`rich-text/polish` 与 `resume/helper` 端点保留、行为不变。** 它们是按钮式 AI 辅助，
  **不是 agent 能力**；删除会造成线上回归。它们一并迁到 Hono 路由，逻辑复用现有 provider。
- **D15：agent 服务获得 Postgres 连接。** tool 读生产库（**只 SELECT**）；session 表读写。
  driver 复用「Neon HTTP / postgres.js 按主机名选择」的思路，agent 内置最小 Drizzle schema（只声明
  它要碰的 `resume` / `agent_session` / `agent_session_event` 三张表），类型从 `@intro-builder/shared` 取。
  CD 需要给 agent 注入 `DATABASE_URL`（建议只读角色）。
- **D16：preview 简历存在 `agent_session.stateJson` 里**（`AgentSessionSnapshot.workspace.draftResume`/
  changeSets 复用现有结构），并作为自定义 `data-preview` UIMessage part 流给前端实时渲染。
- **D17：ask = AI SDK 工具人机回环。** 定义 `ask_user` 工具：`needsApproval` 或无 `execute`，
  产出 tool-input part → 前端 `makeAssistantToolUI` 渲染 ask 面板 → 用户提交 → `addToolResult` →
  下一轮 chat 续跑。不引入独立的 ask 端点。
- **D18：安全落地走开关。** 新链路在 `AGENT_LOOP_ENABLED`（沿用，或新增 `AGENT_V2_ENABLED`）后面
  分阶段上线，旧链路保留到 web 切换完成后再删，保证每个 commit 可部署、可回滚。

## 4. 目标架构

### 4.1 两个 agent 端点（Hono, `apps/agent`）

- `POST /v1/agent/session`（scope `agent:session`）：
  入参 `{ resumeId|null, threadId, mode }`；按 `deriveAgentSessionId` 幂等 upsert `agent_session`
  到 Postgres；返回 `{ sessionId, status, preview, messages }`（当前 preview 快照 + 历史消息摘要）。
- `POST /v1/agent/chat`（scope `agent:chat`，SSE）：
  入参 `{ sessionId, messages: UIMessage[], modelConfig? }`；
  `streamText({ model, system, messages: convertToModelMessages(...), tools, stopWhen: stepCountIs(N) })`
  → `toUIMessageStreamResponse()`。流中：文本增量、tool-input/部分/输出、自定义 `data-preview`。
  跑完把事件落 `agent_session_event`、preview 落 `agent_session.stateJson`。
- 保留：`GET /health`、`GET /ready`、`GET /v1/session`、`POST /v1/rich-text/polish`、
  `POST /v1/resume/helpers/:id`（行为不变）。

### 4.2 工具集（`apps/agent/src/agent/tools.ts`）

- **读类（auto-execute，只读生产库，按 JWT 的 userId/resumeId 限定）**：
  `read_resume`（读当前简历 content）、`list_resumes`、`read_profile`。
- **写类（只改 session preview，绝不碰 `resumes` 表）**：`upsert_section` 等，累积进 preview draft，
  复用 PR #80 的 `ResumeOperation` 产出与 `applyResumeOperation`（web 侧应用时用）。
- **ask 类**：`ask_user`（D17），人机回环补信息。

### 4.3 Web 侧

- BFF：`POST /api/agent/session`、`POST /api/agent/chat`（透传 SSE，签 JWT，沿用 runs 模式），
  `POST /api/resume/[id]/agent-apply`（或 server action）执行 preview→`resumes` 落库（沿用 autosave 写路径）。
- 运行时：`useChatRuntime({ transport: new AssistantChatTransport({ api: "/api/agent/chat" }) })`
  + `AssistantRuntimeProvider` + `Thread`，替换现有 `@assistant-ui/react-ag-ui` 适配。
- UI：`makeAssistantToolUI` 渲染工具卡 / preview 卡 / ask 面板；预览区订阅 `data-preview`；
  「应用更改」按钮调用 apply；「继续对话」即继续同一 session。

### 4.4 AG-UI 作为加强

保留 `@ag-ui/*` 仅用于把 preview / context-status 作为自定义 `data-*` part 叠加在 AI SDK 流上；
不再作为 chat 的核心传输或 JSON 契约。

## 5. 数据流

1. **开会话**：Web `auth()` → 校验简历归属 → 签 `agent:session` JWT → agent upsert session 行 → 返回 sessionId + preview。
2. **一轮对话**：Web 签 `agent:chat` JWT → `/v1/agent/chat` SSE → 读工具按需读生产库 → 写工具改 preview →
   `data-preview` 实时推给前端预览区 → 事件 + preview 落 Postgres。
3. **ask**：模型调 `ask_user` → 前端 ask 面板 → 用户提交 → `addToolResult` → 续跑。
4. **继续修改**：用户在同一 session 再发消息，preview 在已有基础上迭代（从 Postgres 读历史 + preview）。
5. **应用**：用户点「应用」→ Web apply 路由读 session preview → 写入 `resumes`（autosave 写路径）→ preview 标记 applied。

## 6. 必须保住的不变量

- **Web 持有落库权**（decision-log D4）：tool 不写 `resumes`，apply 在 web。
- **autosave 不被打断**（AGENTS.md §7）：apply 走既有保存队列 / `resume:flush-autosave`。
- **鉴权边界**：短期 JWT + scope；CORS 白名单；`/health` vs `/ready` 分离（D5）。
- **只读生产库**：tool 对 `resumes` 等业务表只 SELECT；只有 `agent_session*` 可写。
- **暗色模式 + 中文文案**：新 UI 全部补 `dark:`，面向用户文案纯中文。

## 7. CD 影响

- `Dockerfile`：多阶段 `tsc` 构建 + `node dist/index.js` 不变；新增的 `hono`/`drizzle-orm`/`postgres`
  随 `--prod` 安装自动进镜像。
- `deploy-agent.yml`：新增 `DATABASE_URL`（只读）env；`pnpm verify` + `pnpm agent:build` 仍须绿。
- 端口 / 健康检查 / 优雅退出（SIGINT/SIGTERM）保持。

## 8. 不在本次范围

- OCR / 导入 / AI 解析迁移（decision-log D2）。
- 模型质量调优、离线 eval harness 扩展。
- 多简历跨会话记忆、上下文压缩引擎。

## 9. 风险与缓解

- **agent 拿到生产库连接**（新增攻击面）：用只读角色 + 表级 SELECT 限定 + JWT 作用域限定 userId/resumeId。
- **单轮 chat 时延 > Vercel 代理 120s**：流式增量可见；必要时把长流走浏览器直连（已有 direct-runs 思路）。
- **assistant-ui `useChatRuntime` 是否需 `@ai-sdk/react`**：安装期确认；主包已含集成，倾向不需要额外包。
- **删 JSON 契约层影响面**：开关分阶段 + 旧链路保留至 web 切换完成，逐步删。
- **大改一次性上线**：按第 18 决策分 slice、每个 commit 过闸门、保持可回滚。

## 10. 完成定义（DoD）

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿（AGENTS.md §6）。
- 新增/迁移代码有镜像测试；agent 与 web 两侧测试组通过。
- 手工冒烟：开会话 → 多步工具流实时可见 → preview 实时刷新 → ask 面板补信息 → 继续修改 →
  应用落库 → 暗色模式 + autosave 不被打断。
- CD：`deploy-agent.yml` 路径触发的 `pnpm verify` / `agent:build` 通过；镜像可 `node dist/index.js` 启动。
- 旧 `/v1/agent/messages` + AG-UI JSON 契约层在 web 切换后删除，仓库不留两套并存的长期债。
