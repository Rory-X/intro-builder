# Agent Note: 决策笔记放在 docs/notes，用脚本门禁而非散文约定

Status: implemented

## Problem

这个仓库的协作对象主要是 AI Agent。代码只能说清「系统现在怎么跑」，说不出「为什么必须这样跑、以及放弃了什么」。实际已经出现过代价：

- `29bdb039b` 整体回退了 Hono + AI SDK 重写（14 个 commit），但除了那条 commit message，**「为什么这条路不行」没有任何结构化沉淀**——下一个会话很容易再次提议换成 AI SDK。
- `d30ed01f1` 把 dnd-kit 换成 Pragmatic D&D，理由只在 commit message 里；代码看起来只是「用了另一个库」。
- `docs/superpowers/` 下累积了 89 篇 spec/plan，但它们是**面向单次交付的**（一次性、成对、随发布封存）。跨版本的**承重决策**没有归属地：既不属于某一份 plan，也没有 `INDEX`，检索靠全文搜。

同时，写在散文里的约定对 Agent 基本无效。仓库此前存在的 `.cursor/rules/*.mdc` 有 4 份领域规则（DB 演进、Server Action 鉴权、模板/PDF 一致性、编辑器状态），但它们**从未生效**：本文档写就时 `git ls-files .cursor` 为空，`.gitignore:67` 把 `.cursor/` 整目录忽略——它们是本地专属文件，既没进仓库（别的会话/人读不到），又依赖 Cursor 的加载机制（其它运行时不读）。

## Decision

采用 [write-notes-like-deepseek](https://github.com/czm15053/write-notes-like-deepseek) 的 Agent Notes 工作流，**约定如下**：

**目录与位置**：笔记放在 `docs/notes/`，路径即状态 `{lifecycle}/{class}/yyyy-mm-dd-topic.md`。

- lifecycle：`proposed/`（动手前方案稿）、`implemented/`（已落地，随代码同批更新）、`rejected/`（否决原因，防重犯）、`archived/`（封存，只读）。
- class（封闭集，6 个，不自造）：`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`。
- **不建 `INDEX.md`**：总索引在多分支并行时是最抢手的冲突源；目录位置本身就是索引。

**为什么不放在 `.agents/notes/`（上游默认路径）**：本仓库 `.gitignore:55` 把 `.agents/` 整目录忽略。笔记必须被 git 跟踪——「笔记与代码同一次提交」是这套工作流的命脉，落在被忽略的目录里会被 `git add` 静默漏掉。故改默认根为 `docs/notes`（脚本里只有一处常量 + 一处 `resolve`，已在文件头注明这是 local deviation）。

**机械牙齿（关键：不依赖自觉）**：脚本 vendored 在 `scripts/notes/`（零新增依赖，用仓库已有的 `tsx`），接三个门禁：

- `pnpm notes:verify` → 目录/分类/文件名/笔记间相对链接 + 头块骨架/必备节/`implemented` 禁提案标题 + 归档封印校验。
- `pnpm notes:archive` → 归档（物理移动 + SHA-256 封印 + 入站死链报告）。
- `pnpm notes:anchors` → 软报告（源码 `// Note:` 锚点），退出码恒 0，不进 CI。

**已实测的约束力**（2026-09-23 逐一验证）：自造第七类会被拦；`implemented` 残留 `## Proposal` 会被拦；缺 `## Alternatives considered` 会被拦；笔记间死链会被拦；**归档被篡改一个字符即报 seal mismatch，且 `--write` 无法洗白、git 基线独立兜底**。

**判定门槛**：非平凡改动（改了行为/架构/跨文件契约/流程与工具链/测试策略/落盘或配置格式）必须留笔记；纯机械改动（样式、格式化、错别字、不改行为的依赖补丁、常规 CRUD）直接提交。**优先原地更新既有笔记的事实**（路径、符号、默认值），决定翻转才新开一篇并互链 —— 严禁把 `## Decision` 改写成反面。

## Alternatives considered

- **继续用 `docs/superpowers/specs|plans` 承载所有沉淀** — 零新增结构，且已有 89 篇的历史资产。但 spec/plan 的语义是「一次交付的设计与步骤」，生命周期是「写完 → 执行完 → 封存」，与「跨版本的现行法律」不同族：spec 会随版本堆积成 1.4MB 的历史层，而承重决策需要在每个新会话被检索到、且随代码持续就地更新。两者混在一处会让「当前的规矩」淹没在「历次的做法」里。故保留 superpowers 作为交付流程产物，新增 notes 作为决策归属地。
- **沿用 `.cursor/rules/` 并把 glob 修正到 monorepo 路径** — 改动最小（4 个文件），且规则内容本身质量不错。但它们**没有机械约束**：Cursor 专属加载机制在当前运行时下不生效，规则正确与否无人校验，违反不会被发现。这正是「散文约定」的形态。已改为把其中的承重内容迁进 notes（见 `2026-06-11-resume-content-lazy-migration`、`2026-07-31-collab-tokens-fail-closed` 等），并让 `AGENTS.md` 直接承担入口职责。
- **自己写一套校验脚本而非 vendor 上游** — 更贴合本仓库（可以直接认 `apps/web/...` 路径、复用现有 lint）。但上游脚本已覆盖目录封闭集、头块语法、归档封印（含 git 基线 append-only 对比）这些细节，自己重写等于把已经验证过的边界情况（CRLF/BOM 归一、代码块与 HTML 注释掩码、全角冒号兼容、`Status:` 唯一性）再踩一遍。选择 vendor + 只改路径常量，代价是未来吸收上游更新需要手工 diff。
- **不做门禁，只写进 `AGENTS.md`** — 最省事。但按上面「散文约定无效」的问题陈述，这等于不写。

## Consequences

- **收益**：承重决策有明确归属地且随代码就地更新；「为什么没选另一条路」被结构化保留（备选方案必填，且要求先写对方最强理由）；归档封存是不可篡改的，防过时有了机械含义；违规当场非零退出，不依赖 Agent 自觉。
- **代价与已知上限**：多了一条必须维护的东西——笔记会随代码演进漂移，若不就地更新会比没有更糟（错误信息比缺失信息更危险）。缓解靠 `implemented/` 顶部的维护提醒与 CI 门禁，但**「事实是否仍然正确」是语义判断，脚本管不了**，只能靠人/Agent 在改动时顺手更新。此外 `docs/notes/` 与被 `gitignore` 的 `.agents/` 并存，路径与上游文档不一致，未来同步上游需注意。
- **已知缺口**：门禁能保证结构与链接，**不能保证笔记内容真实**。这是刻意的边界——脚本管结构，意思靠评审。

## Verification

- 脚本：`scripts/notes/*.ts`（vendored，零依赖，可 `tsx` 直跑）。
- 命令：`pnpm notes:verify`（三线串跑）、`pnpm notes:archive`、`pnpm notes:anchors`。
- CI：`.github/workflows/verify-notes.yml` 在 push main 与 PR 时跑 `notes:verify`。
- 模板：`docs/notes-templates/{proposed,implemented,rejected}.md`（放在 notes 根之外，否则会被树校验拦为未知 lifecycle 目录——已实测）。
- 回归方式：`pnpm notes:verify` 应输出 `ok: N note(s) ...` 且退出码 0；故意自造一个 class 目录应非零退出。
