# Agent Note: 工具事件静默消失 —— 适配器读了 SDK 不存在的字段名

Status: implemented

## Problem

AI SDK v6 的 `fullStream` 发出的是协议级片段，`lib/ai/stream-adapter.ts` 负责把它们
翻成业务事件。适配器声明并读取的是：

```ts
{ type: "tool-input-start"; toolCallId: string; toolName: string }
{ type: "tool-input-delta"; toolCallId: string; inputTextDelta?: string }
```

但 SDK 的 `TextStreamPart`（`fullStream` 的元素类型）在**增量阶段**用的是
`id` / `delta`，只有最终定型的 `tool-call` / `tool-result` 才叫 `toolCallId`：

```ts
{ type: 'tool-input-start'; id: string; toolName: string; ... }
{ type: 'tool-input-delta'; id: string; delta: string; ... }
```

后果是**静默**的：真实流送进来时 `part.toolCallId` 恒为 `undefined`，适配器
`return []`，于是 `tool.started` 与参数片段**一个都不会发出** ——
用户看不到工具被调用，工具卡永远不出现。没有任何异常、没有日志，
只有「界面没反应」。

更要紧的是这个缺陷**骗过了测试**：`tests/unit/ai-stream.test.ts` 里的片段是手写的，
用的正是那套错误字段名，所以 24 个用例全绿。测试与实现共享了同一个错误假设，
它们一起错，因而互相验证通过 —— 这是「假绿」的典型形态。

## Decision

新增 `tests/unit/ai-stream-sdk-shape.test.ts`，按 SDK **真实字段名**构造片段；
并在适配器里同时接受两种拼写。

具体做法：

1. 测试文件里定义一个 `RealSdkPart` 联合，字段名**逐字抄自** SDK 声明，
   且刻意**不加** `[key: string]: unknown` 兜底 —— 让字段名写错时无法通过类型检查。
2. 适配器的 `SdkStreamPart` 同时声明 `id`/`toolCallId`（以及 `delta`/`inputTextDelta`），
   新增 `readToolCallId()` / `readInputTextDelta()` 兼容读取，任一存在即可工作。
3. 在类型声明处写明这段历史，避免后人「清理冗余字段」时把兼容又删掉。

「同时接受两种拼写」而非「只改成正确的那套」，是因为 `SdkStreamPart` 是本仓库
自己的最小结构声明（有意不为耦合 SDK 内部形状而直接引用 SDK 类型），
放宽读取的代价（几行）远低于再次静默失效的代价（用户完全看不到工具运行）。

已核对 SDK 内部实现确认 `id` 就是 toolCallId：`activeToolCallToolNames[chunk.id] = chunk.toolName`
与 `tool.onInputStart({ toolCallId: chunk.id, ... })` 都用 `chunk.id`。

## Alternatives considered

- **只把实现改成 `id` / `delta`，测试也跟着改** — 最小改动。否决原因：
  它仍然把「字段名」与「SDK 真实形状」绑死在一个地方，下次 SDK 改名会**再次静默失效**。
  兼容读取把这类失效从「静默」降级为「无需改动」，这是本次事故真正该买到的保险。
- **直接 `import type { TextStreamPart } from "ai"` 用 SDK 类型替代自声明结构** —
  类型上最正确，永久消除字段名漂移。否决原因：`stream-adapter` 是一个**纯函数模块**
  （注释明确写了「本模块是纯函数…因此可以穷举测试」），它当前不依赖 SDK。
  引入 SDK 类型会让这个可穷举测试的边界被外部类型牵扯，且 SDK 的泛型
  （`TOOLS extends ToolSet`）会要求测试构造完整 ToolSet 才能表达一个片段。
  权衡后选择「自声明结构 + 真实形状测试」这一中间位置。
- **只在 `run.ts` 编排层加断言**（例如「一次 tool-call 前必须有对应 tool.started」）—
  能在集成层发现，但位置偏晚：断言失败时已经过了适配器，难以指出「是字段名错了」。
  且它无法覆盖「参数片段没发出」这一半问题（那不影响工具执行）。
- **不加新测试文件，把真实形状用例并进 `ai-stream.test.ts`** — 否决原因：
  那个文件里已有大量手写片段，混入真实形状会让「哪些是 SDK 真形状、哪些是自造形状」
  再次变得不可分辨，正是本次缺陷的成因。独立文件 + 文件内说明更能保住这个区分。

## Consequences

- **收益**：工具调用在真实流下会正确产生 `tool.started` 与参数片段；字段名再次漂移时
  不会静默失效，也不会再让 UI「没反应但不报错」。
- **代价**：`SdkStreamPart` 的 `tool-input-*` 分支现在有两种拼写，读起来略啰嗦；
  兼容读取函数是对「SDK 可能改名」的持续付费。这是有意接受的成本。
- **已知上限**：这次只覆盖了 `tool-input-*` 两组字段。`tool-call` / `tool-result` /
  `tool-error` / `text-delta` / `finish` 已逐一比对 SDK 声明且一致，但**没有**用同样的
  「按真实形状」测试全部锁住 —— 它们的漂移不会被现有测试发现。
- **什么信号发生时该重访**：若升级 AI SDK，先跑 `ai-stream-sdk-shape.test.ts`；
  若它开始失败，说明字段形状变了，此时把新形状写进该文件并同步适配器。
  若要把覆盖面扩到全部片段类型，按本笔记的做法扩写该文件即可。

## Verification

- 红：新增测试在修复前 **4 失败 / 1 通过**（`tool.started` 与参数片段均未发出）。
- 绿：修复后 `ai-stream-sdk-shape.test.ts` 5/5、`ai-stream.test.ts` 24/24。
- 全量 AI 单测 11 文件 / 215 用例通过；`pnpm typecheck` 四包全绿；
  `pnpm lint` 0 error。
