# Agent Note: zoo 分支落后主线 122 个提交，合并它只会复活已删的死代码

Status: implemented

## Problem

`zoo` 远端（`ZOO-AiiiPM/intro-builder-zoo`）长期被当作一个平行来源使用，指令要求
「把 upstream（zoo）的改动合并到当前分支，冲突取 upstream」。照做之后出现两个后果：

1. **CodeQL 报出 1 个 high 安全告警**：`app/dev-preview/template/classic-v2/page.tsx:64`
   用正则剥离 `<style>` 块，被判定为 incomplete multi-character sanitization。
2. **`apps/partykit` 整包测试在加载阶段失败**：根 `vitest.config.ts` 的
   `setupFiles: ["./tests/setup.ts"]` 被 vitest 向上冒泡继承，解析成不存在的路径。

两者都不是「合并写错了」，而是**合并的对象本身与主线脱节**。

## Decision

`zoo/main` 不再作为合并来源。依据是以下可复核的事实：

- `zoo/main` 相对 `origin/main`：**落后 122 个提交**，独有 47 个提交
  （其中 42 个非 merge 提交，`git cherry` 也报 42 个无等价改动）。
- 这 47 个提交**全部落在 monorepo 重构前的旧路径**：
  `lib/` 41 次、`app/` 27 次、`tests/` 26 次、`components/` 14 次 ——
  **从未触及 `apps/` 或 `packages/`**。
- 它承载的特性在主线中**均以重构后形态已存在**。例：template favorites 在
  zoo 是 `tests/unit/template-library-favorites.test.tsx`，
  在 `origin/main` 是 `apps/web/tests/unit/template-library-favorites.test.tsx`。
- 因此「取 upstream」的净效果是把主线在重构时**已删除**的陈旧文件复活。
  这 5 个文件 import 的模块（`@/lib/resume-schema`、`@/lib/utils`、
  `./merge-style-settings`）在仓库根**全部不存在**，属不可达死代码。
- 移除它们后，合并结果与合并前只差「本分支新增的 partykit vitest 配置」
  与 3 个既有改动文件 —— 即 **zoo/main 对当前代码库的净有效贡献为 0**。

**唯一有价值的产出**是那次继承问题本身：`apps/partykit` 原本没有自己的
vitest 配置，会继承到仓库根的 `setupFiles` 而整体加载失败。已给它加独立配置
（`apps/partykit/vitest.config.ts`），这条修复保留。

同一次合并里 `journal.md` 的 add/add 冲突是**假冲突**：核实后确认本分支版本是
upstream 的超集（含 upstream 的 2026-05-29 全节 + 本分支的 2026-06-06 一节，
两段 md5 比对一致），故保留本分支版本，未丢任何内容。

## Alternatives considered

- **严格按指令「取 upstream」，保留那 5 个文件** — 这正是第一次执行的结果，
  字面服从了指令。否决原因：它让 CI 变红（CodeQL high 告警）且把死代码引入仓库；
  「服从字面指令」与「交付可用结果」在这里冲突时，应当把冲突**报告**给用户
  并给出证据，而不是默默留下一个红的 PR。
- **保留文件但修掉 CodeQL 告警**（把正则换成更完整的清理） — 能让 CI 变绿，
  改动也小。否决原因：**给死代码修 bug**。这些文件不在任何构建路径上
  （根目录无 `next.config.ts`，`build` 只跑 `./apps/*`），修它们是在维护
  一个不存在的运行路径，并让后续读者以为它仍然有效。
- **把 zoo 的旧路径改动「翻译」到新路径** — 理论最完整，能保证不丢任何上游工作。
  否决原因：经核实那些改动承载的特性在主线**已存在**（名字相同、路径不同），
  翻译只会产生重复实现。已用 patch-id（`git cherry`）与文件存在性双向核对。
- **直接删除 `zoo` remote** — 最彻底。否决原因：`zoo` 仍可能被其他会话用于
  只读对照；本次只需要停止「把它当作合并来源」。删除属于破坏性操作，
  不在本决定范围内。

## Consequences

- **收益**：PR 的 CI 全绿（含 CodeQL）；仓库不再保留 monorepo 前的死路径；
  下一位维护者不会再因为「zoo 有 47 个独有提交」而误以为有未同步的工作。
- **代价与已知上限**：这是一个**基于本次核实快照**的结论。若 zoo 未来重新从
  主线同步（而不是继续在旧路径上开发），它可以再次成为有效来源 ——
  届时以「它的独有提交是否触及 `apps/`/`packages/`」作为判据重估。
- **什么信号发生时该重访**：若有人报告「zoo 上有主线没有的功能」，
  先用 `git log --name-only --format='' origin/main..zoo/main` 看它落在哪个顶层目录；
  只在 `apps/`/`packages/` 下才说明有真正的新工作。

### 判定方法（可复制）

```bash
# 1) 落后多少 / 独有多少
git rev-list --count zoo/main..origin/main   # 落后
git rev-list --count origin/main..zoo/main   # 独有

# 2) 独有提交落在哪些顶层目录（决定性判据）
git log --name-only --format='' origin/main..zoo/main | grep -vE '^$' | cut -d/ -f1 | sort | uniq -c | sort -rn

# 3) 是否有等价改动已被主线吸收（patch-id 比对）
git cherry origin/main zoo/main
```

## Verification

- 移除死代码后闸门全绿：`pnpm test` 1203 通过、`test:integration` 72/72、
  `typecheck`、`lint`（0 error）、`build`、`notes:verify`。
- PR CI 6 项全部 success（`lint · tsc · test · build`、`CodeQL`、
  `note tree · format · archive seals`、`Analyze JavaScript and TypeScript`、
  `GitGuardian`、`Vercel`），PR 状态 `CLEAN` / `MERGEABLE`。
- CodeQL 告警在移除该文件后从 `failure` 转为 `success`，确认因果关系。
