# Agent Note: 切流协调层 —— 把五个零件串成一个会话对象

Status: implemented

## Problem

P07 任务 3 要把浮窗从旧微服务入口切到 `/api/ai/runs`。前面几个提交把所需零件
都建好了：

| 模块 | 职责 |
|---|---|
| `run-stream` | 网络层：发起、消费 SSE、幂等复用分支、续读 |
| `floating-adapter` | 协议翻译：新 Run 事件 → 浮窗动作 |
| `commit-sync` | 服务端写库后如何同步客户端内容 |
| `task-projection` | 任务卡 |
| `reducer` | 唯一投影来源 |

但它们是**分开的**。没有协调层时，`floating-agent-chat.tsx`（2511 行）要
**同时**处理「替换 fetch 目标」「逐条翻译事件」「判断是否同步内容」
「维护投影」「刷新任务卡」—— 那是把五件事揉进一个大组件。

后果不只是「文件更大」：它让这次切流**无法单测**（要 mock 整个组件环境），
也让回滚变得困难（改动混在一处）。

## Decision

新增 `lib/ai-client/floating-run.ts`：一个可注入的会话对象。

```ts
const session = createFloatingRun(handlers, deps);
await session.start({ resumeId, message, requestId, revision, history, … });
session.getProjection();
session.getTaskCard();
```

组件只需调一次 `start`，然后按回调更新状态 ——
**状态更新逻辑不用改**（这是让组件改动从「重写」变成「替换数据来源」的关键）。

### 回调命名与组件既有实现一致

刻意对齐 `readFloatingAgentStream` 的回调名
（`onTextDelta` / `onToolCall` / `onQuestion`），且 `AdaptedToolCall` /
`AdaptedQuestion` 与组件的 `FloatingAgentToolCall` / `FloatingQuestionRequest`
**逐字段一致**。这样切流时只需换数据来源，不必同时改渲染逻辑。

### 同步内容通过回调交回，协调层不碰表单

服务端写库后需要同步客户端内容，但「写表单」需要 `form.reset` 之类的
具体能力 —— 那是组件/编辑器的职责。因此协调层只**计算** `SyncPlan`
并通过 `onSyncNeeded` 交出去，由调用方决定怎么做。

### 续读不做内容同步

`resumeRun` 走 GET，只返回事件、拿不到 `resumeId`。
**刻意不从事件里猜 resumeId** —— 那属于猜测，而猜错会让同步作用到错误的简历上。

## 实测修正的三个缺陷（写实现后自查 + 测试抓到）

三个都是「typecheck 通过但行为错」的类型：

### 一、重复折叠投影

`consumeRunStream` 内部已经用 `reduceRunEvent` 折叠，并通过 `onProjection`
回传。我在 `handleEvent` 里**又折了一遍**。

后果：两份投影同时存在、其中一份被丢弃。更危险的是两处去重规则一旦不一致
（例如我只用 `eventId` 而内部还用 `sequence`），会得出互相矛盾的结论，
而排查时**无法判断是哪一份在起作用**。

修正：只从 `onProjection` 取。唯一例外是 `resume`（走 GET、不是 SSE），
那里网络层不折叠，因此显式折叠并注明理由。

### 二、`onProjection` 写成空函数

第一版把它写成 `onProjection: () => {}`。那样 `getProjection()` 永远返回
初始空投影 —— 调用方会以为「什么事件都没发生」。

这个缺陷由 lint 提示（`projection` 从未被重新赋值），
而那恰好暴露了「它本该被赋值」这一事实。

### 三、`finalize` 返回写死 `serverContent: null`

明明算出来了却不返回，调用方只能依赖回调、无法在结果里取用。
修正为如实返回。

## 另一处：测试的 mock 不真实（不是实现缺陷）

两例失败后查明：我用 **HTTP 200** 返回 `{ error, code }`，
而 `streamRun` 只在 `!response.ok` 时读取 `code` —— 因此拿到
`unexpected_response`。

**真实服务端在业务错误时返回非 2xx**，所以是我的 mock 不真实。
改用 409 后通过。这一点值得记：错误响应的 mock 必须带正确的状态码，
否则测试会去验证一条现实中不存在的路径。

## Alternatives considered

- **直接在 `floating-agent-chat.tsx` 里内联这五件事** — 少一个模块。
  否决原因：那个文件已 2511 行且承载停靠、移动端、审批逻辑。内联会让切流
  **无法单测**（要 mock 整个组件环境），而这里恰恰包含最容易做错的部分
  （事件顺序、幂等分支、提交同步判据）。抽出来后 22 例可以直接驱动。
- **让协调层直接写表单**（传 `form.reset` 进来）— 调用方更省事。
  否决原因：那会让 `lib/ai-client` 依赖表单实现，破坏分层。
  更重要的是：「是否覆盖表单」是一个**需要组件上下文的决定**
  （本地是否有 dirty 编辑），协调层只适合给判据、不适合执行。
- **组件自己维护 reducer 状态**（不用协调层持有的那份）—
  少一层间接。否决原因：那正是缺陷一的另一种形式 —— 两份投影。
  让协调层成为唯一持有者，`getProjection()` 也就有了明确语义。
- **`resume` 也从事件里推 resumeId** — 让续读也能同步内容。
  否决原因：事件 payload 里没有 resumeId（只有 runId/attemptId/sequence）。
  从 runId 反查 resumeId 需要额外请求，且**猜错会同步到错误的简历上** ——
  那类错误损坏用户数据，代价远高于「续读不同步」这点不便。
- **`onProjection` 空实现、只在结束时给最终投影** — 少回调。
  否决原因：长 Run 期间界面需要渐进更新（工具逐个完成）。
  只给最终态会让用户在整个执行期间看不到任何进展。
- **错误时也做一次同步**（保险起见）— 看起来更安全。
  否决原因：错误意味着没有提交，也就没有「服务端改过内容」这回事。
  多一次同步会多一次无谓请求，且在部分失败场景下可能覆盖本地内容。

## Consequences

- **收益**：切流的客户端部分可单测（22 例）；组件改动从「重写」降为
  「替换数据来源」；投影、任务卡、提交同步都有单一持有者。
- **代价**：多一层间接（约 340 行 + 22 例测试）；调用方需要理解
  `SyncPlan` 的三种动作。
- **已知上限（重要的部分）**：
  - **浮窗仍未切换**。本层让切换变简单，但 `floating-agent-chat.tsx`
    尚未调用它 —— 那需要改那个 2511 行组件（替换 `fetch` 目标与事件分发）
    且**需要人工冒烟**（浮窗/停靠、移动端、暗色、键盘）。
  - **会话历史的来源仍未定**。`start` 接受 `history`，但调用方需要自己从
    浮窗的 `messages` state 映射 —— 映射规则（哪些消息进历史、工具卡是否计入）
    尚未实现。
  - **`finalize` 里的 `receipt.mutationId` 传空字符串**。`planCommitSync`
    不用它（只读 `revision`），但传空值会让将来「按回执追踪撤销」的改动
    需要额外补数据。当前保留了 `lastRevision` 与 `onCommitted` 回调。
  - **未处理「同步期间又有新提交」**（`commit-sync` 的已知上限）。
- **什么信号发生时该重访**：切流后若界面「一直不更新」，先查
  `onProjection` 是否被真的接上（缺陷二就是这类）。
  若用户反馈「AI 改完后我的输入没了」，查 `hasLocalEdits` 是否真的反映
  dirty 状态（那是防止覆盖唯一屏障）。

## Verification

- `apps/web/tests/unit/ai-floating-run.test.ts`（22 例）：
  - **事件分发**：文本 → `onTextDelta`、工具生命周期 → `onToolCall`（含状态变化）、
    等待问题 → `onQuestion`、提案 → `onProposal`、冲突 → `onConflict`、
    终态 → `onEnded`、**投影从网络层取**（不重复折叠）；
  - **getProjection 返回真实状态**：运行后能读到工具与终态、任务卡也可读；
  - **提交同步**：**有回执且无本地编辑 → sync**、
    **有本地编辑 → advance-baseline-only**、
    **无回执不请求同步**、**取内容失败不抛异常**（给 reload 方案）、
    **多次提交取最大 revision**、**结果里带回服务端内容**；
  - **幂等复用**：**返回 reused 而不是假装完成**、
    错误如实传递（带 code/message）、**错误时不做同步**；
  - **续读**：事件被分发且投影更新、**不做内容同步**（拿不到 resumeId）、
    失败如实返回错误；
  - **任务卡**：只在变化时回调。
- 红 → 绿：实现自查发现 3 处缺陷（重复折叠、空 `onProjection`、
  写死 `serverContent: null`）；测试发现 2 例失败，查明是**我的 mock
  用了 HTTP 200**（真实服务端业务错误返回 4xx）。
- 全量：`pnpm test` 1692 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
