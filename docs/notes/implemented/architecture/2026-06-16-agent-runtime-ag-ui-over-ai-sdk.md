# Agent Note: Agent 运行时保持 AG-UI + assistant-ui，Hono + AI SDK 重构已回退

Status: implemented

## Problem

Agent 面板的运行时选型曾经翻过车。`6059c5db2` 把 Agent 链路（前端与 Agent 服务两端）重构成 Hono + AI SDK；随后在 `29bdb039b`（PR #87）被整体回退，回退范围 `f54279b6e..HEAD` 共 14 个 commit，包括 `3ebc94d59`「restore direct browser-to-agent data plane, minimize BFF」。

回退 commit 的措辞是「introduced architectural regressions that degraded the agent experience below the pre-refactor baseline」。**这条被否路线极具诱惑力**——Hono + AI SDK 是更主流、文档更全、示例更多的组合，新会话很容易再次提出「把 Agent 换成 AI SDK 吧」。不写下来，就会重走一遍。

## Decision

Agent 运行时保持 **AG-UI 协议 + assistant-ui 前端** 的组合（`apps/agent/` 服务端，`apps/web/lib/agent/` 与 `apps/web/components/agent/` 前端），消息契约不是普通聊天 JSON，而是 AG-UI 的事件流。

**若要再次尝试 Hono / AI SDK 方向的重写，起点是 `f54279b6e`**（回退前最后一个已知良好状态），并参考 `f54279b6e..29bdb039b` 这段被回退的 commit 作为设计素材——不要从当前 HEAD 重新发明一遍。

## Alternatives considered

- **Hono + AI SDK 重写（已实际落地过并回退）** — 它的最强论据是真实的：AI SDK 提供成熟的流式原语、工具调用编排与 provider 抽象，Hono 轻量且边缘友好，长期看能减少手写的流式与重试代码。但它在这套系统里引入了架构级回归，把 Agent 体验压到基线之下：直接 browser-to-agent 数据面被改成经 BFF 中转（`3ebc94d59` 试图再修回来），并牵连出一串部署期修补（`4e30b5a30` 紧急 migration、`5efa70096` 请求体字段过滤）。回退比继续修补便宜。
- **保留 AG-UI 但换掉 assistant-ui** — assistant-ui 提供了面板、消息列表、流式渲染的开箱结构与运行时适配层，替换它等于重写 UI 层而运行时契约不变，收益不明确、返工面大，未采纳。

## Consequences

- **收益**：Agent 链路保持单一直达的数据面，前端到 Agent 服务不额外套一层 BFF；已通过回退验证过「这套组合能跑到基线之上」。
- **代价与已知上限**：AG-UI + assistant-ui 的组合比 AI SDK 小众，遇到流式/工具调用的边界问题时可参考的社区资料更少，部分能力需要自己实现。**重访触发条件**：如果流式稳定性或工具调用编排的维护成本持续上升，或 AI SDK 生态出现能直接替换现有契约且不引入 BFF 的路径，应带着 `f54279b6e` 作为基线重新评估，而不是直接动手重写。

## Verification

- 服务端契约：`apps/agent/src/`；前端适配：`apps/web/lib/agent/`、`apps/web/components/agent/`。
- 文档：`docs/agent/`（architecture、service-contracts、security-and-stability）。
- 单元测试：`apps/agent/tests/`、`apps/web/tests/unit/agent-*.test.ts*`。
- 回归方式：根应用 `pnpm dev` + `pnpm agent:dev`，走通面板打开、发送消息、工具卡展示、富文本润色。
