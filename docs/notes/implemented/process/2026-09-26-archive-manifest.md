# Agent Note: 归档清单与其 CI 校验 —— 「搬全了吗」必须可机械回答

Status: implemented

## Problem

P07 任务 1 要求在移出源码**之前**建立归档基线与清单。归档 README 把它写成硬条件：

> manifest 至少包含 baselineCommit、retirementCommit、originalPath、archivePath、
> gitBlob、sha256、归档原因。**缺一份 tracked 源文件即未完成。**

问题在于「搬全了吗」在清单之外**无法回答** —— 而漏掉的文件**不会报错**，
只会在某次「从归档恢复」时才发现（那时上下文早已丢失）。

核实后得到两个可直接利用的事实：

- 基线 `050d5bb5e` 存在；
- `apps/agent` 与 `.github/workflows/` 自基线以来**零改动**
  （`git diff --stat` 为空）。

因此归档源可以直接取基线，不需要另记差异。

## Decision

### 1. 清单由脚本生成，不手工维护

新增 `scripts/archive/generate-agent-manifest.ts`（接进 `archive:agent:manifest`）。

- 来源是一张显式的表：`现役路径 → 归档前缀`，**每项带 reason**
  （「为什么保留它」必须可读，归档不是「把不用的东西扫进去」）；
- 排除规则**显式列出**（`node_modules` / `dist` / 真实 `.env` / 私钥 / 快照产物）
  而不是靠「只收 .ts」这类白名单 —— 白名单会让新增的源码类型
  （例如 `.proto`）被静默漏掉；
- `.env.example` **收**：它是示例配置，能解释旧服务需要哪些环境变量。

**来源为空时直接抛错**，不静默跳过 —— 那通常是路径写错了，
而静默跳过会让「归档不完整」变成一个不报错的缺口。

### 2. 为什么固定基线而不取当前 HEAD

归档要求「不能拿当前已改写的新 route 当旧源码归档」。基线是用户决定退役时的
状态；用当前 HEAD 会让「归档的是哪个版本」随每次提交漂移。

清单里同时记 `retirementCommit`（当前 HEAD）—— 若将来在退役前有修补，
这两个值会不同，差异需要另记。

### 3. 校验测试：逐条核对而不是抽查

新增 `agent-archive-manifest.test.ts`（16 例），核心是两条：

- **逐条**比对 `sha256` 与基线内容（73 个文件，本机几百毫秒）；
- **逐条**比对 `gitBlob`（不依赖 sha256 的独立校验）。

**为什么逐条而不是抽查**：清单的价值正是「搬全且搬对」。
抽查会漏掉恰好不在样本里的文件 —— 而那与不做校验没有区别。

另有三条防「数目漂移」：

- 来源目录的 tracked 文件总数必须为 73；
- `apps/agent` 的**每个** tracked 文件都在清单里（最容易被漏的一批）；
- 部署 workflow 必须在清单里（不能只留在 `.github` 下）。

以及敏感文件断言（真实 `.env` / 私钥 / 依赖 / 构建产物一律不得出现）。

### 4. 测试放在会被执行的地方

`apps/web/tests/unit/`，**不是**根 `tests/`。

根 `package.json` 的 test 脚本是 `pnpm --recursive test` ——
**根目录自己的测试不会被执行**。我第一版把测试写在根 `tests/`，
那会变成一个永不运行的摆设（而且在 CI 里显示不出任何异常）。
改用 `fileURLToPath(import.meta.url)` 上溯 4 级定位仓库根。

## 实测修正的三个问题（红 → 绿）

**一、测试目录选错。** 根 `tests/` 不被 `pnpm --recursive test` 拾取
（见上）。移到 `apps/web/tests/unit/`。

**二、`import.meta.dirname` 在当前 vitest 转换链里是 `undefined`。**
路径拼成 `undefined/archive/...`，表现为「清单不存在」。
改用 `dirname(fileURLToPath(import.meta.url))`。—— 这是「看起来更现代
但在此环境不生效」的写法，值得记一笔。

**三、上溯层级数错。** 从 `tests/unit/` 到仓库根需要 **4 级**，
我第一版写了 3 级，得到 `apps/`（探查后确认路径拼成 `apps/archive/...`）。

第三个问题值得特别记：我**连续两次**在同一个地方猜层级
（先用 cwd 猜、再用 `import.meta.dirname` 猜），两次都错。
最后是用一次 probe 测试把 `url`/`root`/`manifest`/`exists` 全打印出来才定位到。
**路径问题不该靠数点号解决，应当打印出来看。**

## Alternatives considered

- **清单手工维护（一个 JSON 文件）** — 少一个脚本。
  否决原因：手工清单与源码的同步没有任何保障，而它要回答的正是
  「搬全了吗」。脚本生成后，清单**必然**与基线一致（除非有人手工改，
  而 `--check` 会抓）。
- **只记 `sha256`，不记 `gitBlob`** — 少一个字段。
  否决原因：两者是**独立**校验。`gitBlob` 证明「这是基线里的那个对象」，
  `sha256` 证明「内容没被改」。只留一个会让另一类问题（例如 blob 指向
  别的提交的同名文件）无法发现。
- **排除规则用白名单**（只收 `.ts` / `.json` / `.md`）—
  更简单，且天然排除敏感文件。否决原因：会静默漏掉 `.proto`、`Caddyfile`、
  `Dockerfile`、`compose.yaml` 等非白名单类型 —— 而它们都是旧服务的
  真实组成部分。显式排除列表让「为什么没收」可读。
- **测试放在根 `tests/`** — 语义上更贴切（它验证仓库级约定）。
  否决原因：**不会被执行**。一个永不运行的测试比没有测试更糟 ——
  它会让人以为有保障。
- **抽查 hash 而不是逐条** — 更快。否决原因：清单的价值是完整性，
  抽查恰好漏掉「不在样本里」的缺失。
- **现在就执行文件移动（任务 4）** — 少一次改动。
  否决原因：任务的顺序是有原因的 —— 先有清单才能验证「移动是否搬全」。
  且移动 `apps/agent` 会牵动 workspace、lockfile、CI 配置与
  `affected-apps`，那是独立的一个提交，混在一起会让两者都难回滚。

## Consequences

- **收益**：「搬全了吗」有机械答案；清单与基线的一致性由 CI 保证；
  归档来源与排除理由都可读；任务 4 的移动有了可验证的验收判据。
- **代价**：多一个脚本（约 250 行）与一个测试（16 例，含 73 次 git 调用，
  约几百毫秒）；清单需在来源变动后重跑（`--check` 会提示）。
- **已知上限**：
  - **源码尚未移入**（`source/` 目录不存在）—— 那是任务 4。本提交只做
    任务 1（基线与清单）。测试里有两条断言把这个状态**如实记录**
    （`source/` 不存在、`apps/agent` 仍在原位），移动后它们会失败 ——
    那是预期的信号，届时应当更新测试与归档 README。
  - **`baseline/` 目录（package/workspace/lockfile 基线副本）未建立** ——
    README 的拟收录结构里有它，但本提交只做清单。锁文件基线属于任务 5
    （收敛构建与依赖）的输入。
  - **`archive:agent:verify` 未接入 CI** —— 只有在有人手工跑时才有约束。
    接入 CI 需要在 `.github/workflows/` 加一步（属任务 4/7）。
- **什么信号发生时该重访**：任务 4 执行移动后，本测试的两条「尚未移入」
  断言会失败 —— 那时应当：① 翻转它们为「已移入」；② 更新归档 README 的
  状态行；③ 把 `archive:agent:verify` 接进 CI。

## Verification

- `apps/web/tests/unit/agent-archive-manifest.test.ts`（16 例）：
  - **形状**：清单存在、基线提交真实存在、entryCount 与条目数一致、
    每条含全部必填字段、归档路径都在归档根下、originalPath 无重复；
  - **逐字节一致**：**每个条目的内容 sha256 与基线相同**（逐条）、
    **gitBlob 与基线一致**（独立校验）；
  - **不漏收**：**来源 tracked 文件总数为 73**、
    **apps/agent 每个文件都在清单里**、部署 workflow 在清单里；
  - **不含敏感文件**：无真实 env/私钥/依赖/构建产物、
    **`.env.example` 允许收**、排除项都带原因；
  - **退役状态诚实**：**源码尚未移入**（`source/` 不存在）、
    旧实现仍在现役路径。
- 脚本：`pnpm archive:agent:manifest` 生成 73 条 / 0 排除；
  `--check` 可校验清单未过期。
- 全量：`pnpm test` 1668 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
