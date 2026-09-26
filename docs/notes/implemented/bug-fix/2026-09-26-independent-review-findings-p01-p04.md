# Agent Note: 独立复核发现的 6 组真实缺陷及修法

Status: implemented

## Problem

P01–P04 的**四道门禁全绿**（typecheck / lint / 1016 单测 / 71 集成），但两位独立复核者
用自建探针发现了 6 组会**静默损坏用户数据**的缺陷。它们全部逃过了既有测试。

这不是「测试不够多」，而是**测试的取样偏了**：

| 盲区 | 后果 |
|---|---|
| 集成用例 16 个全走 experience 数组（`setCompany`） | 单例富文本 / styleSettings / 标题 / 模板**从未被真实 SQL 验证** |
| `resume-mutation-prepare.test.ts` 对单例区块 `set_field` **零覆盖** | 漏掉「单例富文本全废」 |
| adapter 样式测试用 `as never` 造假数据，且两边都有 styleSettings | 永远碰不到「首次改样式」的崩溃路径 |
| 迭代器/批量场景无覆盖 | 漏掉「一次去抖窗口内多次增删排」的顺序问题 |

教训：**门禁全绿只说明「已写下的断言成立」，不说明「没有未被想到的缺陷」。**
下面每条都附了「为什么测试没拦住」，作为补测试时的取样依据。

## Decision

修了以下 6 组缺陷，每组都补了能在修复前失败的回归测试。

### 1. 单例富文本区块一个字都存不进去（阻断）

`editor-adapter.ts` 产出 `target: { section: "summary", field: "content" }` 且哈希**整个 doc**，
而 `prepare.ts` 走 `field !== undefined` 分支去读 doc **内层**的 `content` 数组。
两者永不相等 → `summary`/`skills`/`awards`/`portfolio` 的编辑**永远** `condition_mismatch`。

修法：单例区块的值**就是** TipTap doc，目标是整个 section（不带 field）。
契约里 `SECTION_FIELDS` 的 `content` 是「该区块承载内容」的语义标记，不是 doc 里的键。

### 2. 首次改样式崩溃并毒化整份文档（阻断）

`emptyResumeContent()` **不含** `styleSettings`，于是 `beforeStyle[key]` 为 `undefined`，
`hashValue(undefined)` 抛 `Cannot read properties of undefined (reading 'length')`。
崩溃点在会话 hook 内**不在 try/catch 里** → 状态永久卡在 `pending`，之后连正文也存不上。

修法三处：`differs()` 显式防御 `undefined`；样式比较改用「存在性 + 值」两层判断；
`prepare` 的样式条件校验逐键比对（并拒绝「patch 有键但 before 未给前置值」的输入）。
另修 `set_style` 的 `before: {}` 会**完全跳过**条件校验（可用 `before:{}` 静默覆盖任意样式）。

### 3. 存量旧格式文档正文被静默清空（阻断）

编辑页把**原始 jsonb** 交给身份初始化，而 `initializeItemIdentities` 内部用
`ResumeContent.parse` 校验：v1 的 `experience[].bullets` 被 Zod 剥掉、`content` 被
default 成空 doc，随后 CAS 写回库 —— 用户的文案消失。

修法：**读侧懒迁移放进编排层**（`initializeIdentitiesInStore` 入口先 `migrateContent`），
而不是放在各调用方。这是「任何写库路径都必须先做」的前置条件，放在调用方迟早有人漏。

### 4. 取消拦不住晚到提交（P04 任务 4 的缺口）

提交 CTE 完全不引用 `ai_run`（`grep -c ai_run commit.ts` = 0）。编排层只在**执行工具前**
查一次 `isWritable`，查与写之间的窗口足以让一次已取消的修改落库。

修法：把 fence 做成 UPDATE 的**连接条件** —— `fence_ok` CTE + `UPDATE ... FROM fence_ok`，
`fenceRunId`/`fenceToken` 非空时生效。空集 → 更新 0 行 → 后续 CTE 全为空。
由**单条语句**保证，不依赖任何调用方时序。
（注意 `fence_ok` 必须定义在 `updated` **之前**：PostgreSQL 的 CTE 只能前向引用。）

### 5. askUser 之后继续执行写工具并落库 / 返回值与事件流不一致

`case "asked"` 只 `break` 了 switch，随即 `continue` 消费同一个流 —— 用户还没回答，
文档已被修改，而 `endType` 仍是 `waiting_user`。另一处：已发出结束事件后遭遇取消时，
函数把 `endType` 覆写成 `cancelled` 却**不再发事件**，服务端与客户端会得出不同结论。

修法：`asked` 置 `shouldStopConsuming` 并在循环末尾终止消费；
已结束 + 取消时**补发**一条 `run.cancelled`，让返回值与事件流同源。

### 6. 其它已修项

- **越权读回执**：`lookupReceipt` 在 ownership 校验**之前**执行，命中即返回完整回执。
  修法：回执查询带 `userId` 并核验归属（实测越权者曾拿到他人 revision/versionId）。
- **reducer 无终态保护**：取消路由写 `run.cancelled` 后，晚到的 `run.completed`
  会把状态改回「已完成」。修法：终态后忽略结束类事件（服务端 `finishRun` 已有此保证，两端需对称）。
- **provider 三条绕过**：末尾点主机名（`localhost.` 等价于 `localhost`，而 `new URL()`
  不去点）、`::ffff:0:0:0/96` 与 NAT64 `64:ff9b::/96` 内嵌 IPv4、`100.64/10` 与组播段。
  修法：自己去掉末尾点、按**前缀列表**匹配全部内嵌形式、补齐特殊网段。
- **孤立代理哈希不一致**：手写 SHA-256 把孤立代理按 CESU-8 风格编成三字节，
  与 `TextEncoder`/`Buffer`/`node:crypto` 的标准行为（替换为 U+FFFD）不同。
  经 `hashValue` 不可达，但 `sha256Hex` 是导出 API 且文件头承诺跨端一致。
- **标题变更不落盘**：标题是独立 state 不在表单里，`form.watch` 不触发。
  旧 `use-resume-autosave` 有等价 title effect，迁移时漏掉 → 相对旧行为的回归。
- **提案版本无条件递增**：AI 重新生成逐字节相同的提案会推版本并把已 `committed`
  的提案打回 `pending`。修法：只在 `operations` 真的变化时递增/回状态。
- **`resetStyle` 被丢弃**：`set_template` 记录该字段但提交层从未消费，
  「切模板 = 切排版」的心智模型静默失效。修法：排版属于 content，
  由调用方额外产出一条 `set_style`（模板默认排版来自注册表），分层保持清晰。
- **路由参数未校验**：`?after=abc` / `?limit=-5` 会抛 Postgres 错误变 500。
  取消事件的写入失败也不再让整个 POST 失败（如实返回 `eventRecorded: false`）。
- **顺序推演**：同一去抖窗口内多次增删排时，每条操作携带同一份基线顺序条件，
  而 prepare 逐条比对「执行到它之前」的列表 → 第二条必失败（连点两次「+ 添加」即触发）。
  修法：在 adapter 里维护顺序推演，**且推演必须与 `orderOperations` 的真实执行顺序一致**
  （插入 0 先于删除 2 执行，因此插入的条件是原始列表）。

## Alternatives considered

- **放宽 `prepare` 的顺序校验以容忍批量操作** — 我先这么做了，它「修好」了症状。
  否决原因：它削弱的正是**检测并发增删**的能力，还让两条正确的既有测试失败。
  契约要求顺序条件严格比对；正确的修法是让 adapter 算出与执行顺序一致的快照，
  而不是让校验变松。**放宽校验来通过测试是错误的方向，已回退。**
- **把 `field: "content"` 保留在单例区块上，改 prepare 去读整个 section** —
  改动面更小（只动一处）。否决原因：那会让 `field` 字段的语义在校验层与执行层分裂 ——
  `section + field` 的定位契约必须两边一致，否则下一个读代码的人一定会再踩一次。
- **给 `hashValue(undefined)` 返回空哈希而不是抛错** — 一处改动解决崩溃。
  否决原因：`undefined` 与 `""` 会得到同一个哈希，让「字段不存在」与「字段为空」
  无法区分 —— 那是把崩溃换成了更难发现的误判。正确做法是在**调用点**逐键判断存在性。
- **把读侧迁移放在每个调用方（编辑页、Agent）** — 位置更贴近使用者。
  否决原因：这是「任何写库路径都必须先做」的前置条件，放调用方迟早有人漏掉，
  而漏掉的后果是**静默清空用户文案**。放在编排层入口只需写一次。
- **用「调用方写之前再查一次」替代提交语句内的 fence** — 不需要改 SQL。
  否决原因：查与写之间的窗口正是问题本身，实测可复现「核验通过后取消，工具照样提交成功」。
  只有把条件放进 UPDATE 的 WHERE，数据库才能成为唯一裁决者。
- **让 `resetStyle` 在提交层自己查模板默认排版** — 调用方不用管。
  否决原因：`lib/resume-mutations` 是纯计算层（不依赖服务端资源），
  引入模板注册表会破坏这个边界并让集成测试更难隔离。排版属于 content，
  由知道模板的调用方产出 `set_style` 更符合分层。

## Consequences

- **收益**：单例富文本恢复可用；样式改动不再崩溃；存量旧文档不再被清空；
  取消真正拦得住晚到提交（真库实测 4 个用例）；provider 绕过全部封堵；
  合法代理对与孤立代理的哈希都与 Node 一致。
- **代价与已知上限**：`sha256Hex` 与 `hashValue` 之间多了一层显式判空；
  提交语句因 fence 变成两个分支（带/不带 FROM），可读性略降。
  仍有**未修**项（见下），且复核者指出的「手工冒烟未做」仍未做。
- **什么信号发生时该重访**：若将来引入真正的事务驱动（支持交互式事务），
  fence 可以从 `FROM` 连接条件改回更直观的显式事务写法。

### 未修项（需显式交接）

1. **`events.ts` 的 `resolveEofOutcome` 目前只被单测调用**（`assertSingleAttemptEnd`
   已接入 `run.ts` 的 `asked` 分支）。
   我尝试把它接进 `run.ts`，但**回退**了：它回答的是「EOF 时已持久化的 Run 该记成
   什么」（恢复/巡检路径用），与「本次 attempt 最后该发哪种结束事件」不是同一问题
   —— 硬接只会制造一个**只为覆盖率存在的假调用点**，比留一个明确的未使用导出更糟。
   正确做法：恢复路径（P04 剩余任务 6 的 continue/巡检）落地时调用它，
   并删掉 `run.ts` 中与之重复的本地判断。已在 `events.ts` 写明用途边界。
2. **outbox 投影去重会消耗 sequence**：`allocated` 先取号、`inserted` 再
   `ON CONFLICT DO NOTHING`，去重命中时号已消耗 → 序号有缺口（不影响顺序与去重）。
   修法需把取号移到冲突判定之后（例如先查再取，或接受缺口并修正文档措辞）。
3. **模板库「应用到已有简历」仍走无 revision 的旧 `setTemplate`**
   （`app/(app)/templates/template-library-client.tsx`）。P03 的统一写入只覆盖了编辑器。
4. **schema 漂移**：`db/schema.ts` 缺 `ai_run_lease_idx`、`ai_run_event_source_event_idx`；
   `formatVersion` / `runId` 未登记且全仓无读取点；仓库无 drizzle 漂移门禁。
5. **Neon HTTP 驱动路径未验证**：集成测试只跑了 TCP。plan 要求「两种驱动都验证，
   否则必须明说未通过」—— 当前应表述为**仅 TCP 通过**。
6. **手工冒烟未做**：上述多数修复的「用户可见表现」是由代码路径 + 探针推断的。

## 复核覆盖度的诚实说明

本轮**尝试**用两个不同模型跑独立复核，但 `cursor-local/cursor-grok-4.6-xhigh-fast`
**两次启动均失败且无产出**（未留下任何结论）。因此实际交付的两份复核报告
（P04 一份、P01–P03 一份）都来自同一个模型 `deepseek-v4-flash-ioa`。

这不影响发现的有效性（每条都经我独立复现确认），但意味着
**「两个不同模型的独立视角」这一目标未达成** —— 同一模型的两份报告可能共享同一类盲区。
若要补足，应换一个能稳定启动的提供方再跑一次。

## Verification

修复前后的对照证据（每条都在修复前先复现）：

```bash
# 单例富文本：修复前四个区块全部 FAIL:condition_mismatch，修复后 OK
pnpm --filter @intro-builder/web exec vitest run tests/unit/resume-editor-adapter.test.ts
# 存量文档清空：修复前正文丢失，修复后保留
TEST_DATABASE_URL=<隔离测试库> pnpm --filter @intro-builder/web test:integration
# fence 拦下晚到提交（4 个真库用例：取消后/旧 token/终态/无 fence 不受影响）
# 越权读回执被拒（且幂等未被破坏）
```

新增/加强的测试文件：
- `tests/unit/stable-hash.test.ts`（对照 `node:crypto`，含孤立代理 + 0..200 长度全扫）
- `tests/unit/resume-editor-adapter.test.ts`（单例区块、样式首次改动、5 个批量场景）
- `tests/unit/ai-provider-policy.test.ts`（末尾点、内嵌 IPv4 全部写法、特殊网段）
- `tests/unit/ai-run-route.test.ts`（askUser 后不得落库、返回值与事件流一致）
- `tests/unit/ai-run-reducer.test.ts`（终态保护）
- `tests/unit/ai-run-route-api.test.ts`（参数校验 400、取消事件写失败不 500）
- `tests/integration/resume-mutation-identity-cas.test.ts`（v1 bullets 不被清空）
- `tests/integration/resume-mutation-commit.test.ts`（越权读回执）
- `tests/integration/ai-change-set.test.ts`（版本只在内容变化时递增、决策唯一）

全套闸门：`pnpm test` 132 文件 / **1018 测试**、`pnpm typecheck`、`pnpm lint`
（0 error，12 warning = 改动前基线）、`pnpm build`、`pnpm notes:verify`、
`test:integration` **72/72**（5 个文件，真实 PostgreSQL）。

新增的回归测试还包括：`stable-hash.test.ts`（对照 `node:crypto`）、
`ai-change-set` 集成用例（版本只在内容变化时递增、决策唯一）、
投影无序号缺口、模板应用产出 `set_template` + `set_style`。

### 复核者指出「手工冒烟未做」，已用探针补验

复核者的批评成立：上述修复最初只验证到「adapter → prepare」层，没走真实的 hook /
编辑器路径。补验结果（走真实 `useResumeMutationSession` 与真实 `EditorClient`）：

| 场景 | 补验方式 | 结果 |
|---|---|---|
| 单例富文本（summary）编辑 | 真实 hook + `form.setValue` + 去抖 | 提交 1 次，操作为 `set_field{section:"summary"}` |
| 首次改样式（原无 `styleSettings`） | 真实 hook | 提交 1 次，状态回到 `idle`（不再崩溃卡住） |
| 改标题 | 真实 `EditorClient` 点击「重命名」→ 改输入 → 去抖 | 提交含 `set_title` 操作 |

这三条已固化为回归测试（`editor-client-live-preview.test.tsx` 的
「改标题会触发一次提交」等）。**仍未做真实浏览器手工冒烟**（未跑 `pnpm dev`）——
上述结论来自 jsdom 级渲染与真实 hook，不代表视觉/交互细节已验收。
