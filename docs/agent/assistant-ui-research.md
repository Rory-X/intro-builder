# assistant-ui Research

本文档记录 assistant-ui 对 intro-builder Agent 计划的适配结论。结论基于当前 assistant-ui 官方文档与本项目现有编辑器结构。

## 结论

assistant-ui 适合放在 **Phase 3: Agent Panel**，不适合放在 **Phase 1: 单个富文本润色按钮**。
Phase 2A resume helpers 继续使用本地按钮与 suggestion card；assistant-ui 保留给 Phase 3，因为 helpers 不需要多轮 message state。

原因：

- 富文本润色按钮是局部、短链路、用户确认写回的工作流；引入完整 chat runtime 会扩大交互面。
- assistant-ui 的强项是线程、消息、composer、tool display、streaming chat UI。
- intro-builder 当前最需要先稳住 Web -> Agent auth、Redis rate limit、JSON message/tool/patch contract，再把聊天面板接进来。

## assistant-ui 能提供什么

assistant-ui 是面向 React 的 AI chat / assistant UI 库。它通过 runtime provider 把聊天状态、线程、composer 和消息组件挂进 React 树。

关键能力：

- `AssistantRuntimeProvider` 将 runtime 暴露给 assistant-ui primitives 和 hooks。
- `@assistant-ui/react-data-stream` 可以消费标准 message streaming protocol。
- Data stream runtime 支持 text streaming、tool calls、conversation context、error handling、cancellation、attachments。
- 自定义 backend 可以选择 DataStream、AssistantTransport、External Store 等 runtime 模式。
- AI SDK v6 可通过 `@assistant-ui/react-ai-sdk` 适配。
- 当前开发分支安装的是 `@assistant-ui/react@0.14.15`；所有 assistant-ui import 应集中在 Agent panel/runtime seam，避免污染编辑器主状态。

## 官方资料摘录

- assistant-ui Data Stream 文档说明 `@assistant-ui/react-data-stream` 消费标准 streaming protocol，并支持 text、tool calls、context、error、cancel、attachments：[Data Stream Protocol](https://www.assistant-ui.com/docs/runtimes/custom/data-stream)。
- `AssistantRuntimeProvider` 是把 runtime 接入 assistant-ui primitives、hooks、threads、composer state 的根 provider：[AssistantRuntimeProvider](https://www.assistant-ui.com/docs/api-reference/context-providers/assistant-runtime-provider)。
- 自定义 backend 可选 DataStream、AssistantTransport、External Store 等模式：[Custom Runtime Overview](https://www.assistant-ui.com/docs/runtimes/custom/overview)。
- 当前 `@assistant-ui/react-ai-sdk` 面向 AI SDK v6；如果使用 legacy data stream，要显式选择 data stream runtime：[AI SDK v6](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v6)、[AI SDK v4 legacy](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v4-legacy)。
- 工具调用 UI 可通过 assistant-ui tools 体系表达，但 data stream runtime 不支持 human-in-the-loop approval tools；需要审批流时应直接使用 LocalRuntime 或自定义 runtime：[Tool Calling](https://www.assistant-ui.com/docs/guides/tools)。

## Next.js 16 / React 19 兼容性记录

当前分支使用 Next.js 16 `next build --webpack`、React 19.2.x 和 `@assistant-ui/react@0.14.15`。社区信号显示 assistant-ui 在 Next.js 16 / React 19 / tap runtime 下仍有边界问题需要隔离处理：

- `assistant-ui/assistant-ui#2925` 记录过 `AssistantRuntimeProvider` 在 Next.js 16 + React 19 + Turbopack dev 下的 tap runtime 问题。
- `assistant-ui/assistant-ui#2069` 记录过 Next/React 19 build import/export 类问题；其中也提醒 assistant-ui 组件必须在 `"use client"` 边界内。
- `assistant-ui/assistant-ui#4282` 是 2026-06-08 合并的 tap React hook integration，说明 tap/React 集成仍在快速演进。

本项目当前生产 build 的具体失败是 `@assistant-ui/tap@0.6.0` 的 `react-dispatcher.js` fallback 读取 React 18 的 `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`，而 React 19 只导出新的 `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`。Webpack 会在静态导出检查阶段报错，即使运行时会优先命中新字段。

已采用的本地策略：

- assistant-ui import 仍集中在 `components/agent/agent-runtime-provider.tsx` 和
  `components/agent/agent-panel.tsx`：前者负责 LocalRuntime adapter，后者只使用
  thread/composer primitives；不要扩散到编辑器核心状态。
- `next.config.ts` 只对 `@assistant-ui/tap/dist/core/react-dispatcher.js` 的 `react` request 做 `NormalModuleReplacementPlugin`。
- `lib/agent/assistant-ui-react-compat.ts` 只补齐 tap dispatcher 需要的 React internals alias，不替换全站 React import。
- 不修改 `node_modules`，不禁用 build 错误，不降级 React。

## 对 intro-builder 的推荐模式

Phase 3 推荐使用 assistant-ui 承载 Agent panel 的 thread、composer 和 tool display，但不让 assistant-ui 决定简历产品状态。

Phase 3A 已确认的产品形态是 **Agent Mode replaces left editor**：

- 用户点击编辑器 toolbar 的 `Agent 模式`。
- 左侧编辑列切换为 Agent panel。
- 右侧 `LivePreview` 保持可见。
- RHF、autosave、模板状态、preview 仍由 Web 编辑器掌管。
- 所有写回都必须经过 Web UI 的 `应用` / `忽略` 确认。

Phase 3B runtime 继续采用 LocalRuntime/custom adapter，但 adapter 已改为 async generator。Web BFF 代理 Agent 的 AG-UI `text/event-stream`，adapter 消费 `TEXT_MESSAGE_CONTENT` 增量来更新 assistant-ui 消息，并从 `TOOL_CALL_RESULT` 中解析 tool card 与待确认操作。

Phase 3C 已新增 SDK-compatible Web BFF route：`POST /api/agent/runs` 接收 AG-UI `RunAgentInput`，从 `forwardedProps.introBuilder` 或 `forwardedProps.runConfig.introBuilder` 映射到现有 `AgentMessageRequest`。这让后续 `@ag-ui/client` `HttpAgent` + `@assistant-ui/react-ag-ui` 的 `useAgUiRuntime` 可以接入 Web BFF，而不是让浏览器直连 Agent。

Preferred first integration:

```text
Browser AgentPanel assistant-ui
  -> Next.js /api/agent/messages
  -> Agent Microservice /v1/agent/messages
  -> Basic resume tools
  -> Redis memory / rate limit
  -> Model provider
```

理由：

- 浏览器不需要知道 Agent 内网或部署域名。
- Web route 可以复用现有 Auth.js cookie。
- Web route 可以签发短期 Agent JWT，并把请求代理给 Agent 服务。
- CORS 复杂度低，后续如果 Vercel streaming timeout 成为瓶颈，再切换为 browser -> Agent direct。

Alternative later integration:

```text
Browser AgentPanel
  -> Web /api/agent/token
  -> Agent Microservice /v1/agent/messages
```

这个模式更省 Web 服务器流量，但需要 CORS、短期 token 获取、Agent public endpoint 安全策略更成熟。

## Runtime 选择

| 方案 | 适用阶段 | 推荐度 | 说明 |
| --- | --- | --- | --- |
| LocalRuntime/custom adapter + async generator | Phase 3B/3C current | 高 | 适配 AG-UI SSE，同时保留 human-confirmed operation 写回 |
| `@ag-ui/client` HttpAgent + `useAgUiRuntime` | Phase 3C+ candidate | 中高 | 通过 `/api/agent/runs` 接入标准 `RunAgentInput`，但必须先证明 tool-call part 仍能渲染确认卡 |
| DataStream runtime | 后续可评估 | 中 | 若 assistant-ui 官方 runtime 与 AG-UI adapter 成熟，再考虑替换当前薄适配 |
| AssistantTransport | Phase 3B+ | 中 | 适合后端有更丰富状态同步需求 |
| AI SDK runtime | 待评估 | 中 | 若 Agent 服务采用 AI SDK v6，可复用更多适配 |
| LocalRuntime 直连 provider | 不推荐 | 低 | 会让模型调用回到浏览器或 Web client 边界，破坏微服务目标 |

## 对 streaming protocol 的要求

assistant-ui DataStream 有协议选项。当前实现不直接使用 DataStream runtime，而是让 LocalRuntime async generator 消费 AG-UI SSE，避免 assistant-ui stream decoder 与 Agent 协议不匹配。

当前约束：

- Agent 输出 AG-UI `text/event-stream`，事件至少包括 `RUN_STARTED`、`TEXT_MESSAGE_*`、`TOOL_CALL_*`、`TOOL_CALL_RESULT`、`RUN_FINISHED`/`RUN_ERROR`。
- Web BFF 不解析 stream body，只做 Auth.js、resume ownership、短期 JWT 签发、AG-UI run metadata 映射和 SSE headers 透传。
- assistant-ui 不直接消费自定义 NDJSON；所有事件先通过 `readAgUiSseStream()` 校验。
- 真正的 SDK runtime 替换必须以 `/api/agent/runs` 为 URL，不能绕过 Web BFF；`forwardedProps.introBuilder` 承载 Web-owned resume snapshot。

## Tool calling 策略

Agent panel 可以展示工具调用状态，但简历写入类工具必须 human-confirmed。

Phase 3B 允许的基础 tools 固定为：

- `resume_read`: 读取当前简历摘要和完成度。
- `resume_update_section`: 针对 summary 或 allowlist 富文本 field 生成 `update_section` operation。
- `resume_delete_section`: 生成待确认删除 operation，当前 Web 不自动执行。
- `resume_reorder_sections`: 生成待确认排序 operation，确认后 Web 写回 `sectionOrder`。
- `resume_insert_section`: 生成待确认插入 operation，当前 Web 不自动执行。

禁止的直接执行 tools：

- `save_resume_without_confirmation`
- `delete_section`
- `publish_resume`
- `change_template_without_confirmation`
- `save_to_postgres`
- `apply_patch_without_user_confirmation`

工具调用结果应该回到 Web UI。Agent 只能返回 `ResumeOperation`，用户点击确认后才进入 RHF 和 autosave。STAR 优化必须保守：缺 Result 指标就提示用户补事实，不能编造数字或业务结果。

## Phase 3 UI 形态

Agent panel 应该是编辑器里的辅助工作区，不是营销页，也不是全屏聊天产品。

Recommended desktop layout:

- 左侧 editor column 原地切换为 Agent panel。
- 右侧 preview 常驻可见。
- Agent mode 激活时隐藏或禁用 resize handle。
- Template panel 与 Agent panel 互斥。
- 聊天线程只在用户打开 Agent panel 时渲染。

Recommended mobile layout:

- Phase 3A 不解决移动端 Agent panel。
- Phase 3B 已采用 Sheet-like Agent panel；后续只做体验微调，不再重新设计成右侧 drawer 或全屏 workspace。
- 移动端 Agent panel 不能牺牲保存反馈和主要返回入口。

## 不用于 Phase 1 的原因

富文本润色按钮需要的是：

- 当前 TipTap JSON。
- 当前 section / field path。
- 单次请求。
- 生成建议。
- 用户确认写回。
- 触发 autosave flush。

assistant-ui 提供的是：

- thread runtime。
- message composer。
- multi-turn conversation。
- tool call display。
- attachments 和 message state。

两者不是同一个问题。Phase 1 应该做轻量按钮和 suggestion UI，Phase 3 再引入 assistant-ui。

## 风险

- assistant-ui 的协议和 AI SDK 版本演进快，接入前要重新确认文档。
- assistant-ui/tap 与 Next.js 16 / React 19 的兼容层必须保持局部化；如果 `@assistant-ui/react` 升级后不再需要 shim，应删除 `lib/agent/assistant-ui-react-compat.ts` 和 `next.config.ts` 中对应替换。
- 错选 stream protocol 会导致前端收到 chunk 但 runtime 无法完成消息。
- 如果直接切 `useAgUiRuntime` 而不处理 assistant-ui `tool-call` message part，现有 `AgentToolCard` / `AgentConfirmationCard` 可能消失或重复。
- 如果把 assistant-ui 放进 editor-client 主树，可能增加编辑器首屏 bundle。
- 如果 Agent panel 直接写 RHF，容易破坏 autosave 队列和用户确认语义。
- 如果 tool calling 直接执行写操作，用户会失去对简历内容的控制。

## 后续变更验收清单

Phase 3 后续开发或评审时，用这份清单防止偏离设计：

- Phase 0B Redis ready/rate limit 和 Phase 0C Agent JWT 已完成，后续 Agent Mode 不重写这些基础层。
- Phase 3B 对话流使用 AG-UI `text/event-stream`；JSON 只保留为服务端测试和 debug fallback。
- Agent Mode 是左侧替换，不是右侧 drawer、浮窗或全屏 workspace。
- assistant-ui 不接管 RHF、autosave、模板、preview 或简历持久化。
- 基础简历修改 tools 只返回 `ResumeOperation`，所有写回都经过确认卡。
- 富文本列表 patch 必须保留 TipTap 列表结构。
- assistant-ui 只在 panel 打开后加载；bundle 和 lazy loading 策略不能倒退。
