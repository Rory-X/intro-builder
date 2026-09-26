# Agent Note: Run 流的客户端消费器 —— 复用的是 JSON 不是 SSE

Status: implemented

## Problem

`/api/ai/runs` 在 P04 就已交付，服务端契约完整：SSE 推送业务事件、事件逐条落库
（数据库分配 `sequence`）、`GET ?events=1&after=n` 可续读、幂等复用、
租约互斥、终态落库。

但核实后发现：**没有任何客户端消费方**。

- `apps/web/lib/ai-client/` 里只有投影与展示模块（reducer / task-projection /
  change-set-card / version-history / workspace-recovery），**没有网络层**；
- 浮窗 `floating-agent-chat.tsx` 仍走旧的 `/api/agent/floating/chat`（微服务入口）；
- 全仓库搜索 `/api/ai/runs` 只命中路由文件自身。

因此这一环是 P06「把投影接到 UI」与 P07「唯一入口切流」**共同缺的东西**：
两个切片都需要一个能真正消费新 Run 路由的客户端。

## Decision

新增 `lib/ai-client/run-stream.ts`，做三件事：
`streamRun`（发起 + 消费）、`consumeRunStream`（消费已是 SSE 的响应）、
`resumeRun`（续读）。

### 1. `POST /api/ai/runs` 不一定返回 SSE

这是最容易搞错的一处。当 `requestId` 命中已有 Run 时，服务端返回 **JSON**：

```json
{ "runId": "...", "reused": true, "status": "running", "message": "该请求已创建过任务…" }
```

服务端的注释写明意图：「客户端应去读事件流（GET），而不是期待这里再推一次」。

若统一按 SSE 解析这条分支，结果是**拿不到任何事件、`onDone` 也不会被调用** ——
界面停在那里，看起来像「模型没响应」。这是静默失败，排查时很难定位。

因此实现**先判 `content-type`** 再决定走哪条路径，并把复用作为独立的
返回状态 `{ status: "reused", runId, runStatus }` 暴露给调用方。

### 2. 去重与终态保护不在这里

`reduceRunEvent` 是 P04 定的**唯一**投影来源（两层去重 + 终态保护）。
消费器只调用它，并按 `changed` 决定是否回调 `onProjection` ——
自己不判重。两处规则不一致时会得出矛盾结论，且难以判断是哪一层放行的。

### 3. 续读用 `after` 游标

`resumeRun` 带 `?events=1&after=lastSequence`，只取其后的事件。
不从头重放：头部的 `run.started` 虽然会被 reducer 去重，但白白传输，
且长 Run 上会拉回大量事件。

`runId` 做 URL 编码 —— 它进入路径段，未编码的 `/` 或 `?` 会破坏 URL。

## 实测修正的缺陷（红 → 绿）

**CRLF 分隔的 SSE 一个事件都解析不出来。**

第一版用 `buffer.indexOf("\n\n")` 找事件边界。但 `\r\n\r\n` 里**根本没有
连续两个 `\n`**（是 `\n\r\n`），因此 CRLF 分隔的流永远匹配不到边界 ——
静默停住、不报错。

由测试抓出（`expected [] to have a length of 1 but got +0`）。

当前服务端写的是 `\n\n`，所以线上路径侥幸能用。但代理、中间件或未来的规范
调整都可能改成 CRLF，而那种失效**非常难排查**（界面像「卡住了」）。
改为同时识别两种边界（优先取更靠前且更长的那个）。

## Alternatives considered

- **把消费逻辑写进 `floating-agent-chat.tsx`** — 少一个模块，改动集中。
  否决原因：那个文件已经 2511 行，且承载停靠、移动端、审批等逻辑。
  把一个涉及网络分帧、幂等分支、错误分类的层塞进去，既无法单测
  （要 mock 整个组件环境），也会让 P07 的切流改动与它纠缠在一起。
  拆成纯模块后，25 例单测可以直接驱动各种响应形状。
- **复用浮窗已有的 `consumeFloatingStreamBuffer`** — 两端都是
  `data: <json>\n\n`，分帧规则一致。否决原因：那个函数在组件文件内部
  （未导出），且它的错误语义是「抛异常终止流」。新消费器的语义不同：
  单条事件解析失败应当跳过并继续（一次格式异常不该让用户丢掉后续所有内容）。
- **统一按 SSE 解析，用事件里的 `runId` 兜住复用分支** — 代码更短。
  否决原因：复用分支的响应体是 JSON、没有 `data:` 前缀，解析器拿不到任何事件。
  这正是本笔记开头点出的静默失败。
- **`streamRun` 内部自动续读复用分支的 Run** — 对调用方更友好。
  否决原因：那会把「发起」与「恢复」两个语义混在一起，且需要在这里决定
  是否轮询等待（`reused` 的 Run 可能仍在运行，也可能已结束）。
  当前实现把选择权交给调用方：拿到 `reused` 后自行决定调 `resumeRun`
  还是提示用户「该请求已创建过任务」。
- **`resumeRun` 不传 `after` 时也带 `after=0`** — 参数更统一。
  否决原因：服务端对「没有 `after`」与「`after=0`」的处理可能不同
  （前者是「从头读」，后者也是，但显式传 0 会让日志里两者无法区分）。
  测试断言了「不传时不带该参数」。
- **解析失败时抛出**（让调用方感知）— 更「响亮」。
  否决原因：SSE 分帧错误往往是局部的（一条坏事件），而流本身仍可继续。
  抛异常会让用户丢掉模型后续产出的所有可用内容。当前实现跳过坏事件、
  继续解析，同时把「彻底失败」的情形（无 body、网络异常）如实返回为 error。

## Consequences

- **收益**：新 Run 路由终于有客户端消费方；两个切片的共同前置补齐；
  幂等复用与 CRLF 两个静默失败被显式处理。
- **代价**：多一层网络模块（约 300 行 + 25 例测试）。
  `run-stream` 与浮窗既有的流解析逻辑在分帧规则上重叠（但不是同一份代码），
  将来若服务端改协议需要同时改两处 —— 这会在 P07 归档旧入口时消除。
- **已知上限**：
  - **尚未接入 `floating-agent-chat.tsx`**。本模块提供消费能力，
    但浮窗仍走旧入口。切流需要改那个大组件（P07 任务 3）。
  - **未实现自动重连**。断线后需要调用方自己用 `resumeRun` 续读；
    没有「指数退避 + 自动重试」的逻辑。
  - **未处理心跳 / 保活**。若服务端或代理有超时，长 Run 可能被切断；
    当前没有针对性的保活机制。
  - **未做并发保护**。同一页面同时发起两个 Run 时，`streamRun` 各自独立；
    互斥由服务端租约保证（409），客户端不额外拦截。
- **什么信号发生时该重访**：接入浮窗后若出现「发消息后界面不动」，
  先看是不是 `reused` 分支没被正确处理（本笔记第 1 点）。
  若要支持自动重连，`resumeRun` 已提供 `after` 游标所需的一切，
  可以在其上加退避循环。

## Verification

- `apps/web/tests/unit/ai-run-stream.test.ts`（25 例）：
  - **SSE 分帧**：多个完整事件、**保留不完整尾块**、忽略空/非 data 行、
    **单条坏事件不终止流**、**CRLF 换行**（红→绿的来源）；
  - **流式消费**：逐条回调 + reducer 折叠投影、
    **去重后不重复回调投影**、结束时调 `onDone`、返回 runId、
    无 body 时报错；
  - **幂等复用分支**：**`reused: true` 返回 reused 而非试图解析流**、
    复用分支不回调任何事件、缺 runId 时按异常处理；
  - **错误处理**：HTTP 错误带服务端 code/message、网络异常
    → `network_failed`、非 SSE 且非复用 → `unexpected_response`、
    合法 SSE 走流式路径、请求体带 modelConfig 与 requestId；
  - **续读**：带 `events=1&after&limit`、不传 after 时不带该参数、
    返回事件/状态/游标/终态标记、HTTP 错误可读、网络异常、
    **runId 做 URL 编码**、events 非数组时退化不崩。
- 红 → 绿：25 例中 1 例一开始失败（CRLF 分帧），暴露了只认 `\n\n` 的真实缺陷。
  修正后 25/25 通过。
- 全量：`pnpm test` 1534 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
