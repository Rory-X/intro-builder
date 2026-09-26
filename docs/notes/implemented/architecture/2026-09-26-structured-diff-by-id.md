# Agent Note: 结构化 Diff 按 ID 匹配并显式识别移动

Status: implemented

## Problem

P06 任务 4 要求「完整结构 Diff：按 ID 匹配条目并明确移动；覆盖自定义模块、标题、
模板、样式、sectionOrder、显示状态和 TipTap marks。历史无 ID 时标旧记录并使用
受限比较，不能按下标渲染成可信的来源证明」。

现有的 `lib/resume-diff.ts`（365 行）有两个具体缺口：

1. **数组区块完全没覆盖**。它只处理 `basics` 字段与四个单例富文本字段。
   「经历/项目/教育/研究/自定义模块」的任何变化都 diff 不出来。
2. **富文本按块下标对齐**（`oldBlocks[i]` vs `newBlocks[i]`）。对「同一段落内的
   文字改动」这是对的，但 plan 的验收明确要求
   「两条经历仅交换位置，Diff 显示移动而非互相全文改写」——
   按下标对齐只能给出「两段内容互相改写」，那是**误导性**的。

第 2 点不是理论问题：按下标比较时，交换两条经历会渲染成
「甲公司那段变成了乙公司、乙公司那段变成了甲公司」，用户看到的是
「我的内容被重写了」，而实际只是换了个顺序。

## Decision

新增 `lib/resume-mutations/diff.ts`，与既有的 `lib/resume-diff.ts` 分工：

- 既有模块继续负责**字段内**的文本级 diff（字数级 token 比较，UI 用它渲染
  `ins`/`del` 高亮）；
- 新模块负责**条目与容器层面**的 diff（谁被增删改、谁移动了、容器属性变了没）。

两者关注的粒度不同，因此不是重复实现。

### 1. 按 ID 匹配，位置变化单独报 `moved`

`diffArraySection` 用 `readItemIds` 拿两侧的稳定 ID，建立 id→位置映射。
遍历**新顺序**（保证 UI 展示顺序与当前内容一致），对每条判断：

- 旧侧没有 → `added`；
- 有字段改动 → `modified`（并带真实的新旧位置）；
- 无字段改动但位置变了 → **`moved`**；
- 都不变 → `unchanged`。

被删的条目按旧顺序补在末尾（新顺序里没有它们）。

**优先级是刻意的**：先看内容是否变化，再看位置。
「挪了位置**并且**改了内容」报 `modified` 并保留新位置 ——
那信息量更大，用户需要同时知道两件事。只有「纯粹换位置」才报 `moved`。

### 2. 无 ID 时受限比较，并如实标注

`sectionHasStableIds` 要求该区块**每一条**都有非空 id。
部分缺失也算受限 —— 混用「有 ID 的按 ID、没 ID 的按下标」会让结果自相矛盾，
而自相矛盾的结果比明确的「不完整」更危险。

受限时按下标对齐，且**不报 `moved`**：没有 ID 就无法区分「移动」与「改写」，
报移动等于给出无法证实的结论。`legacyComparison` 标记由
`hasLegacyComparison(diff)` 暴露（只在**受限且有变化**时为 true ——
没有变化时不需要标注「这里的比较不完整」）。

### 3. 容器级覆盖

`ContainerDiff` 覆盖 `title` / `templateId` / `sectionOrder` / `styleSettings` /
`singletonRichText`。两个细节：

- `title` 与 `templateId` 不在 `ResumeContent` 里（它们属于 resume 行），
  因此由调用方显式传入，不传则不比较 —— 而不是从内容里猜。
- `sectionOrder` 区分**重排**与**显示/隐藏**：`moved` 只列「位置变化且仍在集合里」
  的模块。隐藏一个模块不是一个模块「移动」了，混报会让 UI 无法给出不同措辞。

### 4. `id` 不算内容字段

`itemFields` 排除 `id`。把 ID 变化报成「字段改动」会误导 ——
身份变了不是「内容变了」，那是另一类问题（应当被拒绝，而不是展示为 diff）。

## Alternatives considered

- **直接扩展现有的 `lib/resume-diff.ts`** — 用户只需要一个 diff 模块。
  否决原因：两者粒度不同（字段内文本 vs 条目/容器），混在一起会让那个文件
  承担两类职责，而它已经有 365 行。更重要的是：给它加「按 ID 匹配」需要
  把现有的下标循环改成映射查找，那会**改动已被多处 UI 使用的行为**，
  风险远大于新增一个模块。
- **无 ID 时也用「按内容相似度匹配」猜对应关系** — 能给出更像样的 diff。
  否决原因：猜出来的对应关系无法证实，而 plan 明确要求
  「不能按下标渲染成可信的来源证明」。相似度匹配同样不可证明，
  只是看起来更聪明。宁可明确说不完整。
- **无 ID 时也报 `moved`**（用内容相等 + 位置不等推断）—— 能覆盖一部分场景。
  否决原因：内容相等却位置不同，可能是「移动」，也可能是「删掉一条又新增
  一条相同的」。两者对用户的意义不同，而当前信息无法区分。
- **`title` / `templateId` 从 `ResumeContent` 里读** — 调用方更省事。
  否决原因：它们不在内容契约里（在 resume 行上）。从内容里读会读到一个
  不存在的字段，静默返回 undefined，然后「比较两个 undefined 相等」——
  于是标题变化永远 diff 不出来。显式传参让「调用方必须提供」成为编译期事实。
- **把 `id` 变化也报成字段改动** — 更「完整」。否决原因：身份变化不是内容变化。
  把它混进 `changedFields` 会让 UI 显示「id: exp-a → exp-b」这种用户无法处置的信息，
  而且它掩盖了真正的问题（身份不该被命令改写，P01 已用白名单拦住）。

## Consequences

- **收益**：数组区块与容器的变化可被 diff 出来；「只交换位置」正确报 `moved`；
  历史无 ID 时明确标注比较受限，不会被当成来源证明。
- **代价**：仓库里现在有两个 diff 模块（`lib/resume-diff.ts` 与
  `lib/resume-mutations/diff.ts`），需要读者理解分工。已在两个文件里
  互相说明职责边界。
- **已知上限**：
  - **未接线到 UI**。本模块只提供计算，`resume-diff-preview.tsx` /
    `version-history-popover.tsx` 尚未使用它。任务 3（任务卡与提案定位）
    与任务 5（历史聚合与撤销）需要它，那些是后续工作。
  - TipTap **marks 级**的差异（加粗/链接等 mark 的变化）由既有
    `lib/resume-diff.ts` 的 token 比较覆盖，本模块只比较字段整体的 JSON 是否相等。
    plan 要求「覆盖 TipTap marks」，当前是通过「整字段变化 → 交给既有模块
    做 token 级比较」间接满足，**没有**独立的 marks 差异列表。
  - `sectionOrder` 的 `moved` 用「旧位置 vs 新位置」判断，未做最长递增子序列
    之类的「最小移动集」计算。对少量模块足够，模块很多时会多报一些移动项。
- **什么信号发生时该重访**：若 UI 开始同时使用两个 diff 模块并出现
  「同一个变化显示两次」，说明职责边界需要重新划清。
  若需要 marks 级差异列表，应扩展既有模块而不是本模块。

## Verification

- `apps/web/tests/unit/structured-diff.test.ts`（22 例）：
  - **按 ID 匹配**：同序无变化；**只交换位置 → 两条都报 `moved` 且无字段改动**
    （plan 验收第 4 条）；改名 + 移动 → `modified` 且带真实新旧位置；
    新增 `oldIndex=-1`；删除 `newIndex=-1`；`id` 不算内容字段；
  - **受限比较**：两侧缺 ID → `legacyComparison`；**部分缺 ID 也算受限**；
    受限时**不报 `moved`**；`hasLegacyComparison` 只在受限且有变化时为 true；
  - **容器级**：标题/模板变化、未变时不产生条目；`sectionOrder` 区分重排与隐藏
    （隐藏模块不报 moved）；样式从无到有 / 只列真正不同的键 / 相同则不产生条目；
    单例富文本变化；**自定义模块变化**；
  - **hasChanges**：相同为 false，任一变化为 true。
- 红 → 绿：22 例中 1 例一开始失败（样式断言），暴露了我对
  「`styleSettings` 默认为 `undefined` 而非空对象」的理解错误。修正后 22/22 通过。
- 全量：`pnpm test` 1348 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
