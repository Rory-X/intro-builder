# Agent Note: 版本历史按任务聚合，撤销目标是「那条记录」而非「前一条」

Status: implemented

## Problem

P06 任务 5 要求「列表**按任务聚合**，展开看各 revision 和 source；
**单条记录能回到 task/run**。撤销调用服务端**条件** undo，失败保留用户内容」。

核实后发现两个具体缺口：

### 缺口一：读取层没取聚合所需的字段

数据库里 `resume_version` **已经**有全部所需字段（迁移 0014 加了
`revision` / `fromRevision` / `changeSetId` / `runId` / `sourceDetail` / `mutationId`），
提交层也**确实在写**它们（`store.ts` 的 `version_inserted` CTE 逐个写入）。

但读取层没有取出来：既有的 `ResumeVersionListItem` 只有
`id / resumeId / source / sourceLabel / actorName / operationCount / summary / createdAt`。

因此 UI 既**无法按任务聚合**（没有 runId），也**无法跳回任务**（没有 runId/changeSetId）。
数据一直在库里，只是没被读出来。

### 缺口二：`inverse` 生成了但从未被消费

`prepare.ts` 为每个应用的操作生成 `inverse`（条件撤销的依据），
注释也写明「是条件撤销的依据」。但全仓库搜索下来，
**没有任何地方消费它** —— 撤销链路完全未接线。

这是本切片最核心的缺口：`CommitPrincipal.undoOf` 字段、
`source: "undo"` 枚举、条件 undo 的机制都齐了，只差把它们连起来。

## Decision

新增 `lib/ai-client/version-history.ts`，做**投影层**的工作：定义完整读取条目 +
把扁平列表聚合成按任务分组的列表。

### 1. 聚合键是 `runId`，不是版本 id

**一次任务 ≠ 一个版本**：一次 Agent 任务可能产生多个版本
（多个工具各自提交一次）。因此按 `runId` 聚合，没有 `runId` 的记录
（手动编辑、模板切换）各自成组 —— 它们不属于任何任务。

组键刻意**含 `resumeId`**，且用 `\u0000` 分隔：

- 含 resumeId：不同简历上恰好同名的 runId 不该并成一组；
- 用不可打印字符分隔：`resumeId="a" + runId="b:c"` 与
  `resumeId="a:b" + runId="c"` 用普通分隔符会撞键。测试专门覆盖了这一点。

### 2. 组 id 从记录取，不从拼接键切

第一版用 `key.split("\u0000").slice(1).join(...)` 切出组 id，
结果把 `resumeId` 也带了进去（`resume-1\u0000run-new`）。

组 id 是 UI 的 React key 与「跳回任务」的入参，混入 resumeId 会让所有下游
使用者多剥一层。改为**从记录取**（`first.runId ?? first.id`）——
没有这个问题，且与键的构造方式解耦（将来改键的拼接方式不会影响 id）。

这条由测试抓到（`expected 'resume-1\u0000run-new' to be 'run-new'`）。

### 3. 撤销目标是「那条记录」，不是「时间上的前一条」

这是本任务最容易做错的地方。plan 的验收明确要求
「修改 A 后用户补技能，再撤销 A，**技能仍保留**」。

如果撤销实现成「回退到 A 之前的状态」，就会把用户随后补的技能一起抹掉。
正确语义是：撤销 A = 把 A 改过的**那些字段**还原到 A 之前的值，
其它字段不动。这需要条件 undo（`undoOf` + inverse operations），
而**目标内容由提交层计算**。

因此 `findUndoTarget` 只负责**找出那条记录**，不计算目标内容 ——
UI 自己算会重复实现条件判断，且容易算错（它就是那个「回退到前一状态」的错误）。

### 4. `canUndo` 的三条排除

- **撤销记录本身**：撤销一个撤销是重做，属另一个功能；
- **没有 `mutationId`**：旧数据或系统操作，无法构造条件 undo 的幂等键；
- **无主的系统操作**（`source === "system"` 且无 runId）：
  用户没发起过它，不该由用户撤销。有 runId 的系统操作（属于某次任务）可以。

### 5. 撤销失败给「内容未受影响」的说明

`describeUndoFailure` 把错误码翻成可操作中文，且每一条都明确
**用户的内容没被改动**。必要性：条件 undo 失败通常意味着「目标已被改过」，
此时绝不能强行覆盖 —— 用户最需要知道的正是「我的东西还在」。

## Alternatives considered

- **在读取层直接把聚合结果查出来**（SQL 里 GROUP BY runId）— 少一层投影。
  否决原因：聚合属于**展示决策**（怎么分组、按什么排序、组内怎么展示），
  而 SQL 层做这件事会让「改排序规则」需要改查询。放在投影层后，
  同一份数据可以按不同方式聚合（例如将来要按 changeSet 分组），
  且它是纯函数、可穷举测试。
- **按 `changeSetId` 聚合**（提案才是「一组建议」）— 语义上也说得通。
  否决原因：plan 明确说「按**任务**聚合」，而任务对应 Run。
  一次 Run 可能产生多个 changeSet（多轮工具调用），按 changeSet 聚合会
  把一次对话拆成多组。`changeSetId` 保留在记录里供跳转用。
- **没有 runId 的记录也归到一个「手动编辑」大组** — 列表更短。
  否决原因：那会让用户以为那些编辑是同一次操作。它们确实是各自独立的，
  合并显示会误导。而且「展开看各 revision」在 single 组里没有意义。
- **`findUndoTarget` 同时算出要恢复的内容** — 调用方更省事。
  否决原因：那需要把 `prepare` 的反操作生成逻辑搬到这里（或在投影层
  重算条件哈希），而那是提交层的职责。更重要的是：一旦投影层能算出
  「恢复成什么」，就会有人拿它直接写入 —— 绕过条件 undo，变成无条件覆盖。
  当前设计让「算出目标内容」在投影层**做不到**。
- **`canUndo` 只排除撤销记录**（其余都可撤销）— 更宽松。
  否决原因：没有 `mutationId` 的记录无法构造幂等键，撤销请求会因
  `idempotency_key_reuse` 或类似原因失败 —— 给用户一个点了必失败的按钮
  比隐藏它更糟。

## Consequences

- **收益**：聚合所需的字段有了明确的读取类型（当前读取层可据此补齐）；
  聚合与跳转是纯函数、可穷举测试；撤销目标的语义被钉死在「那条记录」上；
  撤销失败不会覆盖用户内容，且用户能看懂。
- **代价**：`VersionRecord` 与既有的 `ResumeVersionListItem` 是两个类型
  （前者更完整）。读取层需要从前者投影出后者，或直接换用前者。
- **已知上限（重要的、不假装完成的部分）**：
  - **未接线到读取层与 UI**。本模块只提供投影函数；
    `loadResumeVersions`（或等价查询）**尚未**取出 `runId`/`changeSetId`/
    `mutationId`/`revision`，`version-history-popover.tsx` 也还在用旧的
    `ResumeVersionListItem`。要让「按任务聚合」在界面上生效，需要改查询
    （加字段）与组件（换成 `VersionGroup[]`）。
  - **撤销链路仍未接通**。`inverse` 依旧没有消费者；
    `commitResumeMutation` 没有把 `prepared.inverse` 返回给调用方，
    也没有「按 undoOf 构造反向命令」的入口。本模块只做了**可行性判断**
    与**失败说明**，真正的条件 undo 需要在提交层加一条路径。
    这是 P06 任务 5 剩余的主要工作。
  - `hasUndo` 只标记组内是否含撤销记录，未做「撤销的撤销」支持（见上）。
  - 聚合不含分页。版本很多时需要调用方先分页再投影
    （投影本身不限制数量，但 UI 一次渲染几千条会有问题）。
- **什么信号发生时该重访**：接线上线后若用户反馈「撤销后别的改动也没了」，
  说明撤销被实现成了「回退到前一状态」而不是条件 undo ——
  那正是本笔记第 3 点要防的错误。若反馈「版本列表看不出哪几条属于同一次对话」，
  检查读取层是否漏取了 `runId`。

## Verification

- `apps/web/tests/unit/ai-version-history.test.ts`（25 例）：
  - **来源标签**：九种来源都有中文说明且不直接展示枚举名、撤销是独立来源；
  - **按任务聚合**：**同任务多版本合成一组**、无 runId 各自成组、
    组内时间倒序、组间按最新时间倒序、展开信息含全部 sources、
    `hasUndo` 标记、**不同简历的同名 runId 不合并**、空列表、
    **组键拼接无歧义**（含分隔符不撞键）、无法解析的时间不抛异常；
  - **回到 task/run**：有 runId 可跳、**无 runId 返回 null**、
    组上 `canOpenRun` 反映是否至少一条可跳；
  - **撤销可行性**：agent/manual 可撤销、**撤销记录不可撤销**、
    **无 mutationId 不可撤销**、无主系统操作不可撤销（有 runId 的可以）；
  - **撤销目标**：`findUndoTarget` 只按 id 找记录、找不到返回 null、
    不计算目标内容；
  - **撤销失败说明**：条件不匹配时明确「你的内容未受影响」且不含原始码、
    每种已知失败都有专门说明、未知码有兜底；
  - **plan 验收场景**：撤销 A 时目标是 A 那条记录（**不是**时间上的前一条，
    否则会抹掉用户随后补的技能）。
- 红 → 绿：25 例中 1 例一开始失败（组 id 混入 resumeId），
  暴露了从拼接键切分的不稳健做法。修正后 25/25 通过。
- 全量：`pnpm test` 1433 例通过、`typecheck` 四包全绿、`lint` 0 error。
