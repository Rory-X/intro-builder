# Agent Note: 补齐 resume_version 的 schema 声明与回执 mutationId

Status: implemented

## Problem

P06 任务 5 要求「列表**按任务聚合**，展开看各 revision 和 source；
**单条记录能回到 task/run**」。上一个提交（`2026-09-26-version-history-grouping.md`）
做完了投影层，但接线时发现数据**根本流不到投影层**，缺口在三处：

### 缺口一：Drizzle schema 缺 6 列

迁移 `0014_add_resume_mutations.sql` 给 `resume_version` 加了
`revision` / `fromRevision` / `changeSetId` / `runId` / `sourceDetail` / `mutationId`，
但 `db/schema.ts` 里的 `resumeVersions` **从未声明它们**。

后果是具体的：数据库里一直有这些列、提交层也一直在写它们
（`resume-mutations/store.ts` 的 `version_inserted` CTE 逐个写入），
但 Drizzle 的查询**无法引用未声明的列** —— 因此 `listResumeVersions`
取不出 `runId`，UI 就无法聚合，也无法跳回任务。

这也解释了为什么 `ResumeVersionListItem` 一直只有 8 个字段：
不是「有意只返回这些」，而是**类型系统里根本拿不到**。

### 缺口二：`source` 类型只声明 3 种，实际写入 9 种

```ts
source: text("source").$type<"manual" | "agent" | "restore">().notNull(),
```

而 `CommitPrincipal.source` 是 9 种（含 `polish` / `template` / `style` /
`system` / `collab` / `undo`）。

读取层的 `sourceLabel` 同样只认 3 种，其余一律返回「手动保存」。于是
**AI 润色被显示成「手动保存」，撤销被显示成「手动保存」** —— 这是对用户
谎报来源，而且会让用户误以为「我没改过这里」。

### 缺口三：回执不带 `mutationId`，撤销拿不到「撤销谁」

撤销链路需要 `mutationId` 作为 `undoOf`（上一个提交
`2026-09-26-conditional-undo-wired.md` 的 `buildUndoCommand` 的输入）。
但这条数据在客户端断了两处：

- `SubmitAccepted`（提交返回类型）没有 `mutationId` 字段；
- `MutationReceipt`（回执）只有 `revision` / `versionId` / `committedAt`。

结果：撤销链路在服务端已通，客户端却**永远构造不出撤销命令**。

## Decision

### 1. 补 schema 声明（不新增迁移）

把这 6 列按迁移 0014 的实际定义加进 `resumeVersions`。

**刻意不生成新迁移**：列在数据库里已经存在（0014 加的），
`db/migrations/meta/` 的快照只到 `0006` —— 本项目**不使用 drizzle-kit 生成迁移**，
迁移是手写 SQL（`tests/integration/helpers/test-db.ts` 按文件名顺序执行）。
因此本改动纯粹是 TS 层「让查询能引用已存在的列」。

集成测试 72 例通过验证了这一点（它是真的建库建表跑的）。

### 2. `source` 类型扩展到 9 种，文案**保留原文案**

类型按 `CommitPrincipal.source` 补齐。文案上有一处必须小心：
**既有三种来源的文案不能改**。

我第一版把 `agent` 的文案写成了「简历助手」，而既有实现与 4 个测试文件
都用的是「**通过对话**」。这是**未经授权改动了用户可见文案** ——
本次改动的目标只是「补齐缺失来源」，不是重写既有措辞。

改正后：`manual` → 「手动保存」、`agent` → 「通过对话」、
`restore` → 「手动恢复」（与原来的三分支实现逐字一致），只新增六种。

`actions.ts` 的本地 `ResumeVersionSource` 与 `sourceLabel` 一并删掉，
统一从 `version-history.ts` 取 —— 避免两处各维护一份（正是漂移的来源）。

### 3. 回执补上 `mutationId`

`SubmitAccepted` 与 `MutationReceipt` 各加 `mutationId: string`。
赋值时服务端回执优先，缺省退回本次请求用的键
（服务端会做幂等校验，两者不一致时以服务端返回的为准）。

`editor-client.tsx` 里由**真实回执**构造的清单项因此带上真实
`mutationId` / `revision`；而由辅助函数构造的本地版本项显式写 `null` ——
它们确实没有这些信息，显式 null 比 `as` 强转诚实。

## Alternatives considered

- **生成一个新的 drizzle 迁移来「加」这些列** — 看起来更规范。
  否决原因：列**已经存在**，真跑会因 `ADD COLUMN` 重复而报错，
  或者需要写成 `IF NOT EXISTS`（0014 已经是这样写的）。
  本项目迁移是手写 SQL 且集成测试直接跑 SQL 文件，没有 drizzle-kit 的
  generate 流程 —— 加一个空迁移只会制造噪音。
- **把 `source` 的文案统一重写得更「产品化」** — 例如 agent 用「简历助手」。
  否决原因：那改的是用户可见文案，属于产品决策而非本次技术任务的范围，
  且会打断 4 个测试文件的既有预期。**我第一版就是这么做的，被测试抓出**。
  本次只补齐缺失来源。
- **在读取层写一个 `source === "agent" ? ... : ...` 的映射，不动 schema**
  — 改动面更小。否决原因：`source` 的 TS 类型仍与实际数据不符，
  任何按 `source` 分支的代码都会漏掉 5 种来源（写的人会以为只有 3 种）。
  类型与真实数据对齐是根本修复。
- **`MutationReceipt.mutationId` 设为可选** — 兼容「旧回执」。
  否决原因：回执是**本次会话内**产生的内存值，不存在「旧回执」；
  可选会让撤销路径多一个「可能没有」的分支，而那正是静默失败的来源。
  设为必填后，构造回执的地方必须显式提供它 —— 编译期就拦住遗漏。
- **让 `undoOf` 用客户端自己生成的 mutationId** — 不必改回执。
  否决原因：客户端生成的那个只用于**本次请求**，服务端可能因幂等
  而复用别的值。用错会让撤销指向一次不存在的提交。

## Consequences

- **收益**：数据打通到投影层（`runId`/`changeSetId`/`mutationId`/`revision`
  可被读取）；来源标签不再谎报；撤销链路在客户端也有了输入。
- **代价**：`ResumeVersionListItem` 多了 4 个字段，所有构造它的地方都要显式提供
  （TypeScript 会强制，因此不会漏 —— 实测改完立刻暴露 3 处）。
- **已知上限**：
  - **UI 仍未接线**。投影层与数据层都已就绪，但
    `version-history-popover.tsx` 还在用扁平的 `ResumeVersionListItem[]`
    渲染，没有调用 `groupVersionsByTask`，也没有撤销按钮。
    要让用户看到「按任务聚合」并能点撤销，还需要改组件 + 加撤销的提交入口
    （路由或 action）+ 破坏性撤销的二次确认。
  - `single` 类型的清单项（由 `createResumeVersion` 辅助函数构造）
    `mutationId` 为 null，因此不可撤销 —— 它们是本地新建的快照，
    没有经过提交模块。
  - 版本列表仍限 50 条（既有行为），未做分页。
- **什么信号发生时该重访**：若用户反馈「AI 润色显示成手动保存」，
  检查是否有新的写入路径用了未列入 `SOURCE_LABELS` 的 source
  （TypeScript 会拦，因此更可能是运行时传入了字符串字面量之外的值）。
  若要做版本列表分页，注意 `groupVersionsByTask` 需要**完整**列表才能正确聚合
  （跨页的同 runId 版本会被拆成两组）。

## Verification

- `apps/web/tests/unit/resume-version-actions.test.ts`（既有文件，更新断言）：
  - `listResumeVersions` **如实读出** `revision` / `runId` / `changeSetId` /
    `mutationId`（这是接线的关键断言）；
  - `createResumeVersion` 的返回显式带 4 个 `null`（本地快照确实没有这些信息）；
  - 来源文案断言保持原文案（`agent` → 「通过对话」）。
- **红 → 绿**：
  - 补断言后立刻失败两次 —— 第一次是缺字段，第二次暴露我改了 `agent` 的文案
    （`expected "通过对话" but got "简历助手"`）。这正是「保留原文案」这条
    决策的依据。
- 集成测试：`pnpm test:integration` 72 例通过（真库建表，验证无需新迁移）。
- 全量：`pnpm test` 1448 例通过、`typecheck` 四包全绿、`lint` 0 error。
