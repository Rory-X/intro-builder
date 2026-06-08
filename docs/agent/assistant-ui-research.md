# assistant-ui Research

本文档记录 assistant-ui 对 intro-builder Agent 计划的适配结论。结论基于当前 assistant-ui 官方文档与本项目现有编辑器结构。

## 结论

assistant-ui 适合放在 **Phase 3: Agent Panel**，不适合放在 **Phase 1: 单个富文本润色按钮**。
Phase 2A resume helpers still use local buttons and cards; assistant-ui remains reserved for Phase 3 because helpers do not need multi-turn message state.

原因：

- 富文本润色按钮是局部、短链路、用户确认写回的工作流；引入完整 chat runtime 会扩大交互面。
- assistant-ui 的强项是线程、消息、composer、tool display、streaming chat UI。
- intro-builder 当前最需要先稳住 Web -> Agent auth、Redis rate limit、streaming contract，再把聊天面板接进来。

## assistant-ui 能提供什么

assistant-ui 是面向 React 的 AI chat / assistant UI 库。它通过 runtime provider 把聊天状态、线程、composer 和消息组件挂进 React 树。

关键能力：

- `AssistantRuntimeProvider` 将 runtime 暴露给 assistant-ui primitives 和 hooks。
- `@assistant-ui/react-data-stream` 可以消费标准 message streaming protocol。
- Data stream runtime 支持 text streaming、tool calls、conversation context、error handling、cancellation、attachments。
- 自定义 backend 可以选择 DataStream、AssistantTransport、External Store 等 runtime 模式。
- AI SDK v6 可通过 `@assistant-ui/react-ai-sdk` 适配。

## 官方资料摘录

- assistant-ui Data Stream 文档说明 `@assistant-ui/react-data-stream` 消费标准 streaming protocol，并支持 text、tool calls、context、error、cancel、attachments：[Data Stream Protocol](https://www.assistant-ui.com/docs/runtimes/custom/data-stream)。
- `AssistantRuntimeProvider` 是把 runtime 接入 assistant-ui primitives、hooks、threads、composer state 的根 provider：[AssistantRuntimeProvider](https://www.assistant-ui.com/docs/api-reference/context-providers/assistant-runtime-provider)。
- 自定义 backend 可选 DataStream、AssistantTransport、External Store 等模式：[Custom Runtime Overview](https://www.assistant-ui.com/docs/runtimes/custom/overview)。
- 当前 `@assistant-ui/react-ai-sdk` 面向 AI SDK v6；如果使用 legacy data stream，要显式选择 data stream runtime：[AI SDK v6](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v6)、[AI SDK v4 legacy](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v4-legacy)。
- 工具调用 UI 可通过 assistant-ui tools 体系表达，但 data stream runtime 不支持 human-in-the-loop approval tools；需要审批流时应直接使用 LocalRuntime 或自定义 runtime：[Tool Calling](https://www.assistant-ui.com/docs/guides/tools)。

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

因此 Phase 3 开始前必须先确定 Agent 输出哪一种协议：

- Phase 3A 不强行做 streaming；先用 JSON contract 证明 message/tool/patch 语义。
- Phase 3B 再优先评估 `ui-message-stream`，贴近 assistant-ui 当前默认。
- 如果 Phase 1/2 已经沉淀自定义 line-delimited JSON stream，Phase 3 需要写 adapter，不要让 assistant-ui 直接消费不兼容流。

## Tool calling 策略

Agent panel 可以展示工具调用状态，但简历写入类工具必须 human-confirmed。

Allowed tool classes:

- `inspect_resume`: 读取当前简历摘要和完成度。
- `propose_rich_text_rewrite`: 针对富文本 field 生成候选 `replace_tiptap_json` patch，不写回。
- `propose_summary_rewrite`: 针对 `basics.summary` 生成候选 `replace_plain_text` patch，不写回。
- `propose_bullet_rewrite`: 针对列表型 TipTap 内容做保格式润色，不把列表压成一整段文本。
- `draft_section_item`: 生成一个待用户确认的 section/item draft。

Disallowed direct tools:

- `save_resume_without_confirmation`
- `delete_section`
- `publish_resume`
- `change_template_without_confirmation`

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
- 错选 stream protocol 会导致前端收到 chunk 但 runtime 无法完成消息。
- 如果把 assistant-ui 放进 editor-client 主树，可能增加编辑器首屏 bundle。
- 如果 Agent panel 直接写 RHF，容易破坏 autosave 队列和用户确认语义。
- 如果 tool calling 直接执行写操作，用户会失去对简历内容的控制。

## 接入前验收清单

- Phase 0B Redis ready/rate limit 已完成。
- Phase 0C Agent JWT 已完成。
- Phase 1 或 Phase 2 已有稳定 Agent API 和 error envelope。
- 已选定 assistant-ui runtime。
- Phase 3A 已确认 JSON message/tool/patch contract；如果做 streaming，必须确认 stream protocol 与后端一致。
- 已有 Agent Mode 左侧替换、不接管 RHF 的设计。
- 已定义基础简历修改 tools 和 `ResumePatch` 确认写回规则。
- 已有 bundle 和 lazy loading 策略。
