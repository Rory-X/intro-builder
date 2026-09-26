# Agent Note: 客户端补上 history 传参，并主动裁剪超长历史

Status: implemented

## Problem

上一个提交（`2026-09-26-run-history-was-discarded.md`）修了**服务端**缺口：
`POST /api/ai/runs` 校验了 `history` 长度却把它丢掉、然后硬编码 `history: []`。

但那只让「传历史」**能生效**。客户端消费器 `lib/ai-client/run-stream.ts`
的 `streamRun` **根本没有传 history** —— 它的请求体只有 requestId / sessionId /
resumeId / revision / message / mode / writeMode / modelConfig。

因此即使服务端修好了，浮窗切过来后仍然每轮失忆。这是我上一份笔记里
明确标注的「下一步」，本提交完成它。

## Decision

### 1. `StreamRunOptions` 加 `history?: HistoryMessage[]`

可选（缺省 `[]`），因为单轮场景确实没有历史。文档注释里写明
「**多轮会话必须传**」—— 这个字段是可选的，但漏传的后果是静默失忆，
因此在类型注释里点明。

### 2. 客户端主动裁剪到服务端上限

服务端对超长历史是**整体拒绝**（400 `history_too_long`）。
那会让用户**连当前这轮都发不出去** —— 而那对用户没有任何帮助：
他只是想继续对话，却被一个关于历史长度的错误挡住。

客户端裁到上限内，至少让对话能继续。用 `trimHistory`（上一个提交抽出的共享函数），
它同时保证裁剪后不以助手消息开头（那对部分模型是非法输入）。

### 3. 如实回报裁掉了多少

`StreamRunResult` 的 `streamed` 分支新增 `trimmedHistory: number`。

必要性：用户会**感知到**「AI 忘了我前面说的」。若静默裁剪，用户会以为是
模型能力问题；如实回报让调用方可以解释原因（例如提示
「对话很长了，已省略最早的几轮」）。

计算只做一次（在 `fetch` 之前算好 `requestedHistory`），避免两处调用
`trimHistory` 得到不一致的结果 —— 那种不一致会让回报的数字与实际发送的
内容对不上，而这正是最难排查的一类偏差。

## 实测修正的问题（红 → 绿）

**既有断言的形状过时**：`ai-run-stream.test.ts` 有两处用
`toEqual({ status: "streamed", runId })` 精确断言整个对象，
新增 `trimmedHistory` 后不匹配。

这**不是回归**，而是断言写得过紧 —— 它顺带证明了「新增字段」这件事
确实发生了（与「改了字段值」不同）。修正为包含新字段，并补 5 例覆盖
history 传参与裁剪行为。

## Alternatives considered

- **客户端不裁剪，让服务端拒绝，把错误暴露给用户** — 语义最直白。
  否决原因：用户看到的是「请求失败」而真实原因是「对话太长」。
  他既不知道要删什么，也不知道怎么继续。客户端裁剪让对话能走下去。
- **服务端自动裁剪而不拒绝**（不在本提交范围内，但值得一提）—
  那会掩盖客户端的 bug（例如它传了 1000 条历史说明它的会话管理有问题）。
  当前设计是「客户端裁、服务端守上限」，两侧职责清楚。
- **裁剪时不回报条数**（静默裁）— 接口更简单。否决原因：用户会感知到
  上下文的缺失。没有数字时无法解释，也无法让调用方决定怎么提示。
- **`trimmedHistory` 也放进 `reused` 分支** — 类型更统一。
  否决原因：复用分支**没有发送历史**（服务端直接返回已有 Run），
  那里没有「裁掉多少」这个事实。硬塞一个 0 会让调用方误以为
  「复用时不裁剪」是经过计算的结论。
- **在 `consumeRunStream` 内部重新计算裁剪数**（而不是由调用方传入）—
  更自治。否决原因：`consumeRunStream` 只拿到 `Response`，看不到原始
  `options.history`。让它接收 `options` 会把「网络消费」与「请求构造」
  耦合起来，而那正是这个模块刻意分开的两件事。

## Consequences

- **收益**：客户端能传历史（服务端的修复因此真正生效）；
  超长历史不会挡住用户；裁剪量被如实回报。
- **代价**：`StreamRunResult` 多一个字段；`streamRun` 与
  `consumeRunStream` 之间多一个 `trimmedHistory` 参数（默认 0，
  因此既有调用方不受影响）。
- **已知上限**：
  - **仍未有真实调用方**。`streamRun` 现在具备完整能力（历史、裁剪、幂等分支、
    CRLF、错误分类），但**浮窗还没接它** —— 那是 P07 任务 3（切流），
    需要改 2511 行的 `floating-agent-chat.tsx`。
  - **会话历史的来源未定**。调用方需要自己维护 `HistoryMessage[]`
    （从浮窗的 `messages` state 映射）。映射规则（哪些消息进历史、
    工具卡是否计入）尚未实现。
  - **裁剪只按条数，不按 token**。长消息（每条接近 20000 字符上限）时
    100 条的体积可能仍然很大。按 token 裁剪需要 tokenizer，当前没有。
- **什么信号发生时该重访**：若切流后用户反馈「AI 忘了前面说的」，
  按这个顺序查：① 调用方传了 `history` 吗；② `trimmedHistory` 是否很大
  （说明裁剪过多，需要更好的会话管理）；③ 服务端是否真的把 history
  传给了编排层（`ai-run-route-history.test.ts` 覆盖这条）。

## Verification

- `apps/web/tests/unit/ai-run-stream.test.ts`（30 例，含新增 5 例）：
  - **history 传参**：**history 被放进请求体**（切流后不失忆的依据）、
    不传时请求体里是空数组；
  - **裁剪**：**超上限时在客户端裁掉**（请求体不超上限且
    `trimmedHistory > 0`）、未超限时为 0、
    **裁剪不改变最近几轮的顺序**（最后一条仍是原历史最后一条）；
  - 既有 25 例（含幂等复用分支、CRLF、错误分类）全部保持通过。
- 红 → 绿：2 例既有断言因新增字段而过时（**不是回归**，
  是断言写得过紧），修正后 30/30 通过。
- 全量：`pnpm test` 1586 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
