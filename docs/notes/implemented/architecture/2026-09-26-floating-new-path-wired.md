# Agent Note: 浮窗接入新路径 —— 分流而不是替换

Status: implemented

## Problem

P07 任务 3 要把浮窗从旧微服务入口切到 `/api/ai/runs`。前面几个提交把零件都建好了
（网络层、协议翻译、内容同步、任务卡、投影、协调层、历史映射、幂等键、客户端开关），
但**没有一件接到组件**。

核实组件现状后，有一个决定做法的关键事实：**既有的 26 处 mock 旧路由的测试**
（`agent-panel-assistant-ui.test.tsx`，3456 行）全部断言 `/api/agent/floating/chat`。
它们是**旧路径的守护者**。

因此「直接替换 `fetch` 目标」是错的做法 —— 那会让那 26 处测试失去意义
（它们会去验证新路径，而新路径已有专门的覆盖），同时**旧路径失去覆盖**。

## Decision

### 1. 分流而不是替换

在请求函数里加一个分流点：开关开启且调用方提供了 `runBridge` 时走新路径，
否则走旧路径（**行为完全不变**）。

这样：
- 既有 26 处测试继续守护旧路径，**一行都不用改**；
- 新路径由独立测试文件（`floating-agent-new-path.test.tsx`，9 例）显式开开关覆盖；
- 回滚只需关开关，不需要回滚代码。

### 2. `runBridge` 是可选 props

组件本身拿不到新路径必需的三样东西（它们都在编辑器一侧）：

| 能力 | 为什么组件拿不到 |
|---|---|
| `getRevision` | CAS 基准来自 `mutationSession`，而组件 props 里没有它 |
| `getHasLocalEdits` | 同上（决定服务端写库后能否覆盖表单） |
| `loadServerContent` / `applyRemoteCommit` | 需要编辑器的表单与基准能力 |

因此它们通过可选的 `runBridge` 注入。**未提供时组件行为与以前完全一致** ——
这正是分流能安全落地的前提。

### 3. 新路径**不调用** `applyStreamOperations`

这是最容易做错的一处，也是新旧路径最本质的差异：

| | 旧路径 | 新路径 |
|---|---|---|
| 谁写库 | **客户端**（`applyOperation` → autosave） | **服务端**（`commitResumeMutation`） |

若新路径也调用 `applyStreamOperations`，服务端写完库之后客户端再写一遍，
就是**双重写库**：两次提交、两条留痕、并发下 revision 还会互相顶掉。

服务端写完后由 `runBridge.applyRemoteCommit` 同步客户端内容
（判据由 `commit-sync` 的 `planCommitSync` 给出：有本地编辑时只推进基准、
不覆盖表单）。

### 4. 幂等命中如实报错而不是假装完成

新路由在 `requestId` 命中已有 Run 时返回 JSON（不是 SSE），意图是
「去读事件流（GET）」。组件此时抛出「该请求已创建过任务，请稍后查看结果或刷新页面」
—— 假装完成会让界面显示「已完成」而内容从未更新。

## 实测修正：一个 flaky 的**真正**根因

全量跑时 `editor-client-version-history.test.tsx` 的 Esc 用例失败一次，
单独跑 3 次全过。**我上一轮已给它加过 `waitFor`**，但显然没修彻底。

这次查清了真正根因：Escape 的处理在 `editor-client.tsx` 的一个 `useEffect` 里注册，
而**该 effect 的依赖数组含 `viewedVersion`**。因此必须先让 effect 重跑完再派发
`keydown` —— 否则监听器闭包里的 `viewedVersion` 还是旧值（`null`），Escape 被忽略。

`fireEvent.keyDown` 是**同步派发**，而 React 提交 effect 要等一次调度：
本地机器快、effect 已重跑完所以通过；全量并发时 CPU 紧张、赶不上就失败。

**我上一轮的错误**：只给**断言**加了 `waitFor`，没有处理**派发**的时序。
断言等待的是「结果出现」，而这里的问题是「输入根本没被处理」——
等再久也不会变。

修法：派发前用 `act` 排空一次微任务，确保 effect 已生效。
验证方式是**连续 3 次全量跑**（这才是暴露该 flaky 的场景），全部 1751 例通过。

## Alternatives considered

- **直接替换 `fetch` 目标**（一次性切流）— 改动最集中、代码最干净。
  否决原因：那 26 处 mock 旧路由的测试会全部改道去验证新路径 ——
  于是**旧路径失去覆盖**（而它仍在服务未开开关的用户）。且回滚需要回滚代码，
  而分流只需关开关。
- **让 `runBridge` 成为必填 props** — 类型更简单、不会漏传。
  否决原因：那会强制**所有**调用点立即具备新路径能力，
  等于把「接线」与「切换」绑在同一个提交里。可选 props 让它们分开：
  本提交只接线，切换由开关控制。
- **在组件内自己读 `mutationSession`** — 省掉注入。
  否决原因：组件拿不到它（props 里没有），而那正是这个注入存在的原因。
  更深一层：CAS 基准必须来自**同一份** mutation session，
  组件自己另建一个会让两者的 revision 各自演化 —— 那正是 spec §6 要防的。
- **新路径也调用 `applyStreamOperations`「保持兼容」** — 表面上两种路径
  行为一致。否决原因：双重写库。两条独立提交链会各自推进 revision，
  并发下互相顶掉；而且留痕里会出现两条记录（一条服务端、一条客户端）。
- **幂等命中时静默继续**（当成正常完成）— 界面流程更顺。
  否决原因：内容从未更新，而界面显示「已完成」—— 用户会以为改好了。
  如实报错让他知道「这个请求之前已创建过任务」。
- **给 flaky 测试加更长的超时或重试** — 最快让它变绿。
  否决原因：那掩盖的是一个真实的时序假设错误（派发与 effect 提交的顺序），
  而这类假设在别的测试里也会犯。修根因只需一行 `act`。
- **跳过那个 flaky 测试** — 最省事。否决原因：它在守护版本历史切换与
  Esc 行为，跳过等于放弃那部分覆盖。

## Consequences

- **收益**：新路径真正可用（9 例验证打到新路由、事件被翻译、请求体契约、
  内容同步、错误处理）；旧路径与它的 26 处覆盖完全不受影响；
  回滚是关开关而非回滚代码；一个 flaky 的根因被修清。
- **代价**：组件里多一个分流点与一个注入 props（约 180 行）；
  两条路径并存到 P07 结束（这是刻意的——旧路径要服务未开开关的用户）。
- **已知上限（重要的部分）**：
  - **默认 surface 仍是 `"panel"`**（旧 AgentPanel → AG-UI → `direct-runs`）。
    也就是说：**浮窗即使能走新路径，用户默认仍看不到它**。
    翻转 `readAgentSurface()` 需要独立提交 + **人工冒烟**。
  - **`runBridge` 尚未由 `editor-client.tsx` 提供**。
    本提交让组件具备新路径能力，但调用方还没传 ——
    因此实际运行时仍走旧路径（开关也未开）。
    提供它需要改 `editor-client.tsx`（把 `mutationSession` 的
    `getBaseline`/`applyRemoteCommit` 与表单 reset 接进去）。
  - **未做刷新恢复接线**（`restoreWorkspace` 还没接）。
  - **提案卡（change-set）未接线**：新路径的批准走独立路由，
    组件目前只 toast 提示「请确认后应用」—— 提案卡组件已就绪但未接入。
  - **新路径的测试用 mock 的 SSE**，未做真实浏览器冒烟。
- **什么信号发生时该重访**：切流后若界面「一直不更新」，
  先查 `onProjection` 是否被接上（协调层里那类缺陷的教训）。
  若用户反馈「AI 改完后我的输入没了」，查 `getHasLocalEdits` 是否真的
  反映 dirty 状态（那是防覆盖的唯一屏障）。
  若要完成切换，需要：改 `editor-client.tsx` 提供 `runBridge`、
  翻转默认 surface、接线提案卡与刷新恢复、人工冒烟。

## Verification

- `apps/web/tests/unit/floating-agent-new-path.test.tsx`（9 例，新增）：
  - **路由选择**：**请求发往 `/api/ai/runs` 而不是旧路由**
    （且**不同时打旧路由**——那会双跑两条链路）、
    默认（未开开关）仍走旧路由；
  - **事件翻译**：**文本增量累积显示**、**工具事件渲染成工具卡**
    （标题来自业务映射）、**等待问题渲染成问题卡**；
  - **请求体契约**：**带上 revision / requestId / modelConfig / history**，
    且首轮 `history` 为空（当前消息单独作为 `message` 传）；
  - **内容同步**：**有回执时调用 `applyRemoteCommit`**
    （否则界面显示旧内容）、**无回执时不调用**（诊断类任务不该动表单）；
  - **错误处理**：**非 2xx 时提示错误而不是假装成功**。
- `apps/web/tests/unit/editor-client-version-history.test.tsx`（8 例，
  修掉 flaky 根因）：**连续 3 次全量跑全过**（1751 例）。
- 既有 `agent-panel-assistant-ui.test.tsx`（50 例）**一行未改即通过** ——
  这是「旧路径未受影响」的可验证证据。
- 全量：`pnpm test` 1751 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）、`build` 通过。

## 一处测试写法教训

新路径测试第一次跑时，错误用例断言失败，实际显示的是
`undefined: Expected 409 to be one of: Null, Undefined, Object`。

根因是**我的测试写错了**：`Response.json(payload, 409)` 的第二个参数是
`ResponseInit` 字典，传数字会触发 WebIDL 校验错误 ——
而那个错误被当成服务端文案显示。

正确写法是 `new Response(JSON.stringify(payload), { status: 409, headers: … })`。
已在测试里就地注明，避免下一个人踩。
