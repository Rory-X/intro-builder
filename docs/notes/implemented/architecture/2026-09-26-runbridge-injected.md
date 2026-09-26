# Agent Note: 由编辑器注入 runBridge，开关才真正有路可走

Status: implemented

## Problem

前一批工作（`2026-09-26-floating-new-path-wired.md`）让浮窗**具备**新路径能力
（分流点、`runBridge` 类型、事件翻译、内容同步），但**调用方没传
`runBridge`**。

于是出现一个很具体的死角：**打开 `NEXT_PUBLIC_AI_RUN_PATH=new` 也没有用** ——
组件里的判据是 `runBridge && resolveClientRunPath().useNewPath`，
前一项永远为假，分流点永远不会进入新分支。

也就是说：开关看起来接好了、测试也全绿（新路径测试自己传了 `runBridge`），
但**生产上打开开关不会有任何效果**。这类「能力齐备但没有人喂它」的缺陷，
在两端各自测试都通过的情况下完全不可见。

## Decision

在 `editor-client.tsx` 里构造 `runBridge` 并传给浮窗。

### 1. 三样能力的来源

它们都在编辑器里，组件的 props 里没有：

| 能力 | 来源 |
|---|---|
| `getRevision` | `mutationSession.getBaseline().revision` |
| `getHasLocalEdits` | 新增的 `mutationSession.hasLocalEdits()` |
| `loadServerContent` | `getResumeMutationBaseline` + `migrateContent` + `safeParse` |
| `applyRemoteCommit` | `mutationSession.applyRemoteCommit` + `form.reset` |

### 2. 为什么新增 `hasLocalEdits()` 访问器

`applyRemoteCommit` 内部用的判据是 `dirtyRef.current || inFlightRef.current`。
新路径需要**同一个**判据来决定「能不能把服务端内容写进表单」。

刻意不让调用方从 `status` 推断：两处判据一旦不一致，就会出现
「hook 认为没有本地编辑、于是覆盖了表单；而调用方认为有」这类**自相矛盾**的
行为 —— 且难以判断是哪一层错了。

因此把这个判据本身暴露出来，而不是让每个调用方各自重算一遍。

### 3. `revision` 必须来自 `mutationSession`

服务端会用它与权威 revision 比对（spec §6）。任何本地推断值都会在某些时序下
与服务端错位，表现为「**明明没冲突却报冲突**」—— 错误信息说冲突，
但用户确实没改过，极难定位。

### 4. `loadServerContent` 走 migrate + safeParse

读取层（`getResumeMutationBaseline`）返回 `unknown` —— 可能是旧格式。
直接当 `ResumeContent` 用会让旧数据在表单里出现结构错位。
解析失败返回 `null`（而不是抛），让 `commit-sync` 给出
`reload(missing-content)` 方案 —— 那是可重试的失败，不该让整轮运行失败。

### 5. 传入 `runBridge` **不**开启新路径

是否走新路由仍由 `NEXT_PUBLIC_AI_RUN_PATH` 控制。
因此本提交**不改变任何现有行为** —— 既有 50 例旧路径测试一行未改即通过。

这是刻意的：让「接线」与「切换」是两件事，后者需要开关 + 人工冒烟。

## Alternatives considered

- **让浮窗自己读 mutationSession**（省掉注入）— 组件拿不到它，
  而这正是注入存在的原因。更深一层：CAS 基准必须来自**同一份** session，
  组件自己另建一个会让两者的 revision 各自演化 —— 那正是 spec §6 要防的。
- **让调用方从 `status` 推断 `hasLocalEdits`** — 少一个访问器。
  否决原因：见上第 2 点。`status === "conflict"` 等状态与
  `dirtyRef || inFlightRef` 并非等价，两处判据会漂移。
- **`loadServerContent` 解析失败时抛异常** — 调用方能立刻知道有问题。
  否决原因：内容取不到/格式旧是**可恢复**情况，协调层已经能给出
  `reload(missing-content)` 方案。抛异常会把可恢复情况变成一次运行失败。
- **把 `runBridge` 做成必填 props** — 类型更强、不会漏传。
  否决原因：那会强制**所有**调用点立即具备新路径能力，等于把「接线」与
  「切换」绑在同一个提交里 —— 而「切换」需要人工冒烟。
- **本提交同时翻转默认 surface** — 一步到位。否决原因：翻转后默认用户
  会走新路径，而新路径**从未在真实浏览器冒烟过**。那正是服务端开关当初
  默认关闭的理由；只在客户端硬切等于把那个保护绕过去。

## Consequences

- **收益**：开关从一个「看起来接好但无效」的状态变成**真的有路可走**；
  `hasLocalEdits` 的判据在两层之间统一。
- **代价**：`editor-client.tsx` 多约 45 行（一个 `useMemo`）；
  hook 的公开接口多一个访问器。
- **已知上限（重要的部分）**：
  - **新路径仍不持久化对话消息**。旧路由会 `appendFloatingChatMessage`
    写浮窗会话表，而新路径**完全不写** —— 刷新后按会话恢复的对话历史
    **看不到新路径产生的消息**。这是切流仍缺的一环（下一批工作）。
    注意：Run 自身的状态可从 `GET /api/ai/runs/[runId]?events=1` 恢复，
    缺的是**展示用**的会话历史。
  - **默认 surface 仍是 `"panel"`**：浮窗即使有路可走，用户默认仍看不到它。
    翻转需要开关 + **人工冒烟**。
  - **未做刷新恢复接线**（`restoreWorkspace` 还没接）。
  - **未做真实浏览器验证**。
- **什么信号发生时该重访**：若打开开关后浮窗行为不变，先查
  `runBridge` 是否被传（本提交修的就是这个）。
  若要完成切换，需要：新路径持久化 → 刷新恢复 → 翻转默认 surface →
  人工冒烟。

## Verification

- 全量：`pnpm test` 1751 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
- 既有 `agent-panel-assistant-ui.test.tsx`（50 例）**一行未改即通过** ——
  这是「传入 runBridge 不改变现有行为」的可验证证据。
