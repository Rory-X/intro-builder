# assistant-ui Research

本文档记录 assistant-ui 对 intro-builder Agent 计划的适配结论。结论基于当前 assistant-ui 官方文档与本项目现有编辑器结构。

## 结论

assistant-ui 适合放在 **Phase 3: Agent Panel**，不适合放在 **Phase 1: 单个富文本润色按钮**。

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

Phase 3 推荐使用 assistant-ui 的 DataStream 或 AssistantTransport 模式，而不是让 assistant-ui 直接决定业务状态。

Preferred first integration:

```text
Browser AgentPanel
  -> Next.js /api/agent/messages
  -> Agent Microservice /v1/agent/messages
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
| DataStream runtime | Phase 3 MVP | 高 | 后端只需要输出标准 stream，前端接入较薄 |
| AssistantTransport | Phase 3 后 | 中 | 适合后端有更丰富状态同步需求 |
| AI SDK runtime | 待评估 | 中 | 若 Agent 服务采用 AI SDK v6，可复用更多适配 |
| LocalRuntime 直连 provider | 不推荐 | 低 | 会让模型调用回到前端或 Web client 边界，破坏微服务目标 |

## 对 streaming protocol 的要求

assistant-ui DataStream 有协议选项。默认是 `ui-message-stream`，legacy data stream 要显式设置 `protocol: "data-stream"`。如果 backend 与 decoder 不匹配，会出现 stream flush 失败。

因此 Phase 3 开始前必须先确定 Agent 输出哪一种协议：

- 推荐优先评估 `ui-message-stream`，贴近 assistant-ui 当前默认。
- 如果 Phase 1/2 已经沉淀自定义 line-delimited JSON stream，Phase 3 需要写 adapter，不要让 assistant-ui 直接消费不兼容流。

## Tool calling 策略

Agent panel 可以展示工具调用状态，但简历写入类工具必须 human-confirmed。

Allowed tool classes:

- `inspect_resume`: 读取当前简历摘要和完成度。
- `suggest_rewrite`: 生成建议，不写回。
- `explain_template`: 解释当前模板排版。
- `draft_section`: 生成一个待用户确认的 section draft。

Disallowed direct tools:

- `save_resume_without_confirmation`
- `delete_section`
- `publish_resume`
- `change_template_without_confirmation`

工具调用结果应该回到 Web UI，用户点击确认后才进入 RHF 和 autosave。

## Phase 3 UI 形态

Agent panel 应该是编辑器里的辅助工作区，不是营销页，也不是全屏聊天产品。

Recommended desktop layout:

- 右侧 `Sheet` 或固定 side panel。
- 宽度约 `360px` 到 `420px`。
- 保持 editor 和 preview 的主工作区优先级。
- 聊天线程只在用户打开 Agent panel 时渲染。

Recommended mobile layout:

- 使用现有 `Sheet` 从右侧或底部打开。
- composer 固定在底部。
- 不遮挡保存状态和主要返回入口。

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
- 已确认 stream protocol 与后端一致。
- 已有 Agent panel 不接管 RHF 的设计。
- 已有 bundle 和 lazy loading 策略。
