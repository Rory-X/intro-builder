# Agent Note: 编辑器写入统一走 revision 提交，本地输入与已保存正文分离

Status: implemented

## Problem

P02 建好了唯一写入口（`commitResumeMutation`），但编辑器还在走三条**互不相干**的旧写入路径：

1. **手动输入** → `saveResume`：整份内容覆盖写，`WHERE id AND userId`，**不带 revision**。
2. **模板切换** → `setTemplate` + `setTemplateState`：只更新行上的 `templateId`，不写留痕。
3. **恢复历史版本** → `restoreResumeVersion`：先 `insert` 一条备份版本，再 `update` 正文。

这三条各有各的问题，而且互相叠加：

- **并发保护不成立**。「覆盖写」没有 CAS 条件，两个标签页同时编辑时后写者静默赢，
  先写者的内容消失且没有任何提示。
- **半应用状态**。模板走一条 SQL、正文走另一条：模板已换而正文未换时，用户看到的
  是既非旧版也非新版的第三份内容，且无法撤销（没有留痕可以回退到）。
- **恢复不是原子的**。备份与正文是两条独立 SQL，中途失败会留下「只有备份没有恢复」
  或反之的错乱状态。
- **保存状态会说谎**。`useResumeAutosave` 的 `onSave(content)` 拿到的是表单快照，
  回执到达时若用户已继续输入，旧实现没有任何机制保证新输入不被视为「已保存」。

还有一层更隐蔽的问题：**「已保存」被定义为「请求发出去了」**。老 `useResumeAutosave`
在 `await onSave(...)` 成功后就把状态置为 idle，而 `onSave` 内部是覆盖写 + 回读校验。
它无法区分「服务端确实落盘了」与「提交被拒绝/冲突」。

## Decision

### 1. 一个语义差量适配器：`editor-adapter.ts`

提交模块只接受 `SemanticOperation[]`，编辑器持有整份表单内容，中间必须有人做翻译。
`buildMutationOperations({ baseline, next })` 负责这件事，三条规则不可让步：

- **前置条件哈希来自 baseline**（服务端已确认的内容），不是当前表单 —— 否则
  「提案基于哪一版」这一信息就丢了；
- **按稳定 ID 对齐条目**，下标只用于「发现变化」，绝不用来表达目标；
- **只产出真正变化的操作**。无变化返回空数组，提交层据此返回 `no_change`，不写空修订。
- **条目缺 ID 直接拒绝**（`needs_identity`），不回退到下标猜身份。

### 2. 写会话：`use-resume-mutation-session.ts`

核心是**本地输入状态与已确认基准是两个东西**：

- RHF 始终是输入的唯一真相，hook **从不** `form.reset()`。收到回执只推进基准，
  因此回执到达前用户继续输入的字符、改过的标题、换过的模板都不会被擦除。
- 每次提交由 `baseline → 当前表单` 的差量算出命令，带稳定 `mutationId` 与
  `expectedRevision`。**重试复用同一个 ID 与逐字节相同的 payload**，服务端才能把它
  识别为幂等重放而不是第二次修改。
- 冲突时保留本地 dirty 内容并**暂停覆盖式重试**，`flush()` 以 `MutationConflictError`
  拒绝 —— 调用方不能把冲突当成功。
- 暴露 `committedCount`：UI 用它区分「从未保存过」与「刚保存完」。

### 3. 三条路径收敛到同一提交

- `saveResume` 不再被编辑器调用（旧函数保留给尚未迁移的调用方）；
- 模板切换变成一次普通的 `set_template` 操作，与正文在**同一条 SQL** 更新；
- 恢复历史版本改为 `commitResumeRestore`：全量还原作为**一个不可分割的用户意图**提交，
  同样走 CAS + 修订快照 + 回执 + outbox。恢复也受 revision 保护，也能被再次恢复。

### 4. Agent 应用路径同样只写一次

Agent 应用修改时，对上表单的 `setValue` **已经**会触发一次统一提交；旧实现又在
`commit()` 里额外调用 `createResumeVersion` 写一条独立留痕。这造成**同一次操作两次写入**：
一条带 revision、参与幂等，另一条绕过 revision 且不参与幂等，两者互不知晓。
后果是历史里出现重复条目，并发下还会产生「正文 revision 与留痕版本对不上」的错位。

现在 `commit()` 只做不写库的两件事（标记历史边界、把内容压进本地历史栈），落盘交给统一提交；
「查看差异」由**提交回执**里的 `versionId` 驱动 —— 它正是这次提交在服务端留下的修订快照，
因此差异视图与历史列表同源，不会展示一个服务端并不存在的版本。

### 5. 润色候选应用前的原文校验

润色是异步的：点「AI 润色」与点「应用」之间存在任意长度的时间窗口。旧实现直接把候选
写进编辑器，等于用 AI 的旧文本覆盖用户在这期间敲的字，且没有任何提示。

`polish-guard.ts` 在应用前比对「候选所依据的原文」与「当前内容」，不一致就拒绝并提示
重新生成。比对用**结构化内容哈希而不是纯文本**：纯文本相同但结构不同（列表变段落、
marks 变化）时，纯文本比较会误判为「没变」，从而放行一次会丢失格式的应用。

### 6. 协作改动不冒充个人本地输入

协作同步通过 `form.setValue` 把远端改动写进表单，形式上与用户自己输入无法区分。
若不额外标注，这些改动会被记成 `manual` —— 留痕里出现「看起来像是 owner 手打的」这种
错误归因。`setNextSource("collab")` 在应用远端改动前标注，且**只影响紧随其后的一次提交**，
避免一次标注长期生效、把它之后真实的手动输入也误标。

（契约还要求：无法可靠归因时显示「协作同步」而非编造协作者身份。当前 `source: "collab"`
配合服务端从可信上下文取 `actorName`，不采信任何客户端自称的身份。）

### 7. 「已保存」只在确实提交过之后出现

`status === "idle"` 有两种含义：「没有待保存」和「刚保存完」。页面刚挂载时就是 idle。
若据此更新保存时间，用户一打开页面就看到「刚刚保存」——一次凭空捏造的假状态。
因此 UI 只在 `committedCount > 0` 且回到 idle 时才显示已保存。

## Alternatives considered

- **保留 `saveResume` 作为回退路径，与新提交并行运行** — 迁移期最稳，任何新路径的
  问题都能退回旧行为。否决原因：两套写入同时工作会让同一次编辑产生**两条**提交，
  其中一条不带 revision。这正是 plan 明令禁止的「旧 saveResume 绕过提交模块」，
  而且双写造成的重复留痕比单条旧路径更难排查。
- **让 hook 在回执后 `form.reset(服务端内容)`，用「服务端才是真相」保证一致** —
  实现直观，且能天然解决冲突（永远以服务端为准）。否决原因：会丢掉用户在回执到达前
  的输入。用户在 2 秒去抖窗口里敲的字会被一次网络往返悄悄抹掉，这是最不可接受的
  一类数据丢失。正确做法是保留本地输入、只推进基准。
- **恢复历史版本继续留在 action 里，只补一个 revision 检查** — 改动最小。否决原因：
  「备份」与「正文变更」仍是两条独立 SQL，中途失败仍会半应用；而原子性要么由一条
  语句给出，要么由真正的事务给出。既然 CTE 通道已经存在，没有理由为恢复另开一条。
- **为恢复构造逐字段差量，复用 `commitResumeMutation`** — 代码复用度最高。否决原因：
  恢复的语义是「整份内容变成历史版本」。逐字段差量在同字段被并发修改时会产出
  「一部分恢复、一部分保留」的第三份内容，用户无法理解也无法预期。
- **在编辑器里对冲突自动 rebase（重放不相交的字段）** — 对用户更友好，不必手动重试。
  否决原因：契约把 rebase 列为后续工作，且它需要「哪些字段不相交」的精确判断；
  首期严格返回冲突并保留输入是更安全的选择。这条已记录为明确的待办而非遗忘。

## Consequences

- **收益**：手动编辑、模板切换、历史恢复三条路径现在共用同一套 revision 保护与留痕；
  并发编辑不再静默覆盖；重试不重复写；「已保存」有可查询的回执作为凭据；
  恢复失败时界面不再显示成功。
- **代价与已知上限**：首期冲突策略是**严格返回冲突**，不做不相交字段 rebase ——
  两个标签页改不同字段也会有一方收到冲突提示。`use-resume-autosave.ts` 被保留但
  不再被编辑器使用（Agent 路径尚未迁移，见下），仓库里暂时同时存在新旧两套保存设施，
  这是迁移中间态而非最终状态。旧 `saveResume` / `setTemplate` action 仍在导出。
- **什么信号发生时该重访**：若「改不同字段也冲突」明显影响可用性，应在同一提交模块内
  实现有条件 rebase。`use-resume-autosave.ts`、`saveResume`、`setTemplate`、
  `createResumeVersion` 目前仍作为导出存在但有**零编辑器调用点**；P04 之后若确认无其他
  调用方，应一并删除，避免后来者误用这条无 revision 保护的路径。

## Verification

- 适配器：`apps/web/tests/unit/resume-editor-adapter.test.ts`（19 例）——
  含「仅交换位置产出 reorder 而非两条全文改写」「缺 ID 拒绝」
  「适配器 → prepare 端到端结果等于目标内容」。
- 会话：`apps/web/tests/unit/use-resume-mutation-session.test.ts`（16 例）——
  含「回执到达前继续输入不被擦除」「冲突保留本地输入且不覆盖式重试」
  「重试复用同一 mutationId」「本地有未保存输入时 applyRemoteCommit 不覆盖表单」。
- 编辑器集成：`editor-client-live-preview.test.tsx` 断言提交的是针对 `basics.name` 的
  语义操作（比「整份内容里有新值」更强）；`editor-client-version-history.test.tsx`
  断言模板撤销/重做与历史恢复都走统一提交且携带 revision。
- 恢复的原子性在 `apps/web/tests/integration/resume-mutation-commit.test.ts` 中
  由真实数据库验证（CAS、幂等、故障注入回滚）。

```bash
pnpm --filter @intro-builder/web exec vitest run \
  tests/unit/resume-editor-adapter.test.ts \
  tests/unit/use-resume-mutation-session.test.ts \
  tests/unit/editor-client-live-preview.test.tsx \
  tests/unit/editor-client-version-history.test.tsx
TEST_DATABASE_URL=<隔离测试库> pnpm --filter @intro-builder/web test:integration
```

全套 DoD 通过：`pnpm test`（120 文件 / 779 测试）、`pnpm typecheck`、`pnpm lint`
（0 error，12 warning = 改动前基线）、`pnpm build`、`pnpm notes:verify`；
集成测试 29/29。

## 实测发现（下一位不要重踩）

1. **不要用 `window` 判断「是否服务端」**。jsdom 也提供 `window`，用它会误杀所有
   `actions.ts` 的单测（那些测试是合法的服务端调用）。判据用 `process.versions.node`：
   jsdom 跑在 Node 上因此通过，真实浏览器没有它。
2. **`form.getValues()` 返回的是活引用，不是快照**。把它直接当「已确认基准」保存，
   后续 `setValue` 会让基准跟着一起漂移，于是差量恒为空 —— 表现为「一直显示保存中，
   但内容永远不落盘」。基准与「发送瞬间快照」都必须深拷贝。
3. **重试必须复用逐字节相同的 payload，不只是同一个 mutationId**。每次重试重新生成
   operation id 会让服务端算出的 requestHash 变化，幂等判定失效（或更糟：被当成新请求
   重复写）。因此缓存的是「语义哈希（剔除 operation id）+ 原样 operations」。
4. **关键值不要放在 React state 里然后 `await` 后读取**。`setState` 的重渲染发生在
   await 返回之后，那一刻读到的仍是旧值（`null`），依赖它的功能会静默失效。
   需要在 await 之后同步读取的值用 ref。
5. **模板是独立 state，不在表单里**。仅调用 `flush()` 会因为「没有待保存改动」直接返回，
   必须先 `schedule()`；否则表现为「界面换了模板、服务端没收到」。
6. **`status === "idle"` 不等于「刚保存成功」**。页面刚挂载、无本地改动时也是 idle。
   据此更新保存时间会让用户一打开页面就看到「刚刚保存」——一次凭空捏造的假状态。
   只有 `committedCount > 0` 之后的 idle 才代表已保存。
