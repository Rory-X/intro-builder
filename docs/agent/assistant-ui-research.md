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

Phase 3A runtime 首选 LocalRuntime/custom adapter 或等价薄适配层，先跑通稳定 JSON contract；DataStream/SSE 在 Phase 3B 再升级。原因是当前产品需要 human-confirmed writeback，直接追求 streaming protocol 容易把协议稳定性和 UI 状态一起放大。

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
| LocalRuntime/custom adapter | Phase 3A | 高 | 先适配现有 Web BFF JSON contract，最适合 human-confirmed patch 写回 |
| DataStream runtime | Phase 3B | 中 | 后端输出标准 stream 后再接入，避免首版协议漂移 |
| AssistantTransport | Phase 3B+ | 中 | 适合后端有更丰富状态同步需求 |
| AI SDK runtime | 待评估 | 中 | 若 Agent 服务采用 AI SDK v6，可复用更多适配 |
| LocalRuntime 直连 provider | 不推荐 | 低 | 会让模型调用回到浏览器或 Web client 边界，破坏微服务目标 |

## 对 streaming protocol 的要求

assistant-ui DataStream 有协议选项。默认是 `ui-message-stream`，legacy data stream 要显式设置 `protocol: "data-stream"`。如果 backend 与 decoder 不匹配，会出现 stream flush 失败。

因此 Phase 3B 开始前必须先确定 Agent 输出哪一种 streaming 协议：

- Phase 3A 不强行做 streaming；先用 JSON contract 证明 message/tool/patch 语义。
- Phase 3B 再优先评估 `ui-message-stream`，贴近 assistant-ui 当前默认。
- 如果 Phase 1/2 已经沉淀自定义 line-delimited JSON stream，Phase 3 需要写 adapter，不要让 assistant-ui 直接消费不兼容流。

## Tool calling 策略

Agent panel 可以展示工具调用状态，但简历写入类工具必须 human-confirmed。

Phase 3A 允许的基础 tools 固定为：

- `inspect_resume`: 读取当前简历摘要和完成度。
- `propose_rich_text_rewrite`: 针对富文本 field 生成候选 `replace_tiptap_json` patch，不写回。
- `propose_summary_rewrite`: 针对 `basics.summary` 生成候选 `replace_plain_text` patch，不写回。
- `propose_bullet_rewrite`: 针对列表型 TipTap 内容做保格式润色，不把列表压成一整段文本。
- `draft_section_item`: 生成一个待用户确认的 section/item draft。

禁止的直接执行 tools：

- `save_resume_without_confirmation`
- `delete_section`
- `publish_resume`
- `change_template_without_confirmation`
- `save_to_postgres`
- `apply_patch_without_user_confirmation`

工具调用结果应该回到 Web UI。Agent 只能返回 `ResumePatch`，用户点击确认后才进入 RHF 和 autosave。STAR 优化必须保守：缺 Result 指标就提示用户补事实，不能编造数字或业务结果。

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
- Phase 3B 可评估现有 `Sheet`，但不能牺牲保存反馈和主要返回入口。

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
- 如果把 assistant-ui 放进 editor-client 主树，可能增加编辑器首屏 bundle。
- 如果 Agent panel 直接写 RHF，容易破坏 autosave 队列和用户确认语义。
- 如果 tool calling 直接执行写操作，用户会失去对简历内容的控制。

## 接入前验收清单

Phase 3A 开发或评审时，用这份清单防止偏离设计：

- Phase 0B Redis ready/rate limit 和 Phase 0C Agent JWT 已完成，Phase 3A 不重写这些基础层。
- Phase 3A 只使用 JSON message/tool/patch contract；如果做 streaming，必须进入 Phase 3B plan 并确认 stream protocol 与后端一致。
- Agent Mode 是左侧替换，不是右侧 drawer、浮窗或全屏 workspace。
- assistant-ui 不接管 RHF、autosave、模板、preview 或简历持久化。
- 基础简历修改 tools 只返回 `ResumePatch`，所有写回都经过确认卡。
- 富文本列表 patch 必须保留 TipTap 列表结构。
- assistant-ui 只在 panel 打开后加载；bundle 和 lazy loading 策略不能倒退。
