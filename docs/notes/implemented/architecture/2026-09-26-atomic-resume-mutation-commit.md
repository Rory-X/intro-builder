# Agent Note: 文档提交走单条参数化 CTE，回执即「已保存」的唯一凭据

Status: implemented

## Problem

旧链路有三个互相纠缠的缺陷，共同点是**「保存成功」没有单一事实来源**：

1. **改动与留痕分开写**。旧 `createResumeVersion` 是在保存成功之后**异步**补一条版本
   记录。中间任何一步失败，用户就得到「正文变了、历史里没有」的无痕修改（规格 F05）。
2. **生成操作即宣告成功**。悬浮工具返回 `applied: true` 只是说「模型生成了一条建议」，
   但前端把它当成「已经改好并保存了」（F04）。模型于是在下一轮对话里基于一个
   从未落盘的状态继续推理。
3. **重试会重复改文档**。网络超时后客户端重试，服务端没有任何机制识别这
   与上一次是同一个逻辑请求，于是同一处被改两遍、历史里多出一条假记录。

另一条硬约束排除了最直觉的解法：**Neon HTTP 驱动不支持交互式事务**
（`db.transaction(callback)` 直接抛错）。所以「开事务 → 逐条执行 → 提交」
这条在 postgres.js 上可行的路，在两种驱动共用的代码里走不通。

## Decision

`apps/web/lib/resume-mutations/commit.ts` 是**唯一**允许写 `resume.content` 的入口，
它通过**一条**参数化 CTE 完成全部写入。

### 1. 四个写入在同一条 SQL、同一个快照里

`store.ts` 的 `buildCommitStatement` 用 `WITH` 串起：

- `updated`：`UPDATE resume ... WHERE id AND userId AND revision = expected RETURNING ...`
  —— `revision` 是 CAS 条件，`userId` 是授权条件；
- `version_inserted` / `receipt` / `event_inserted`：三者都 `FROM updated u JOIN ...`，
  即**只从 `RETURNING` 的结果派生**。

这条因果链是关键：`UPDATE` 影响 0 行时 `updated` 为空，后续三个 CTE 自然全空，
语句不会「假装成功」。任一插入失败，整条语句回滚 —— 不需要显式 `ROLLBACK`，
也不可能出现「正文改了、回执没写」。

### 2. `mutationId` 是幂等键，回执是成功凭据

- 幂等语义定义在 `UNIQUE(resumeId, mutationId)` 上：**一次逻辑请求固定一个 ID**，
  超时重试必须复用同一个 ID 和同一份 payload。
- 同 ID 同 payload → 返回**原回执**（原 `revision`、原 `versionId`），不产生第二版本。
- 同 ID 异 payload → 409 拒绝（`requestHash` 比对）。
- 只有 `status: "committed"` + 回执才代表服务端已落盘。模型 token 结束、
  前端 `setValue`、SSE 关闭都不算。

### 3. CAS 失败必须**用新语句**重查回执

并发下 `UPDATE` 影响 0 行有两种可能：真的 revision 冲突，或另一个事务刚用同一个
`mutationId` 提交成功（响应丢失场景）。区分它们必须**换一条语句**重查 ——
同一条语句处于同一 MVCC 快照，看不到更新的事务刚提交的行，会把「已经提交」
误报成「重复失败」。

### 4. 身份初始化用**内容 CAS**，不用 revision CAS

条目 ID 的补齐（P02 任务 3）刻意**不推进 `revision`**：它没有改变用户的文案、
顺序或样式，只是补内部标识；推进 `revision` 会让编辑器凭空收到一次「内容已变化」
冲突。

代价是 `WHERE revision = ?` 在这里**失去守卫能力**（revision 不变，并发的第二次
初始化同样满足条件）。因此身份初始化改用 `WHERE content = <读到的原内容>::jsonb`
做 CAS：第一次写入后内容已变，第二次必然不匹配。失败后**重读**以区分
`already_initialized`（并发赢家已写入）与 `concurrent_edit`（期间有真实编辑，不可覆盖）。

## Alternatives considered

- **用 `db.transaction(callback)` 逐条执行** — 最符合直觉，代码也最好读，回滚由数据库
  显式管理。否决原因：Neon HTTP 驱动的 `transaction()` 直接抛错。项目同时支持
  Neon HTTP 与 postgres.js 两种驱动（`db/connection.ts` 按主机名切换），
  为一种驱动写一条只有它能跑的事务路径，等于让测试通过的驱动和生产实际用的驱动不一致。
- **多条 SQL 顺序执行 + 失败时手工补偿（写一条「回滚」记录）** — 不需要 CTE，
  也不需要理解 MVCC。否决原因：补偿本身也会失败，于是需要补偿的补偿；而且
  「正文已改、补偿未写」的窗口在崩溃场景下无法闭合。原子性要么由一条语句给出，
  要么由真正的事务给出，没有第三种可靠的形态。
- **在写入后再异步补版本记录（旧 `createResumeVersion` 的思路）** — 已有实现，
  改动最小。否决原因：这正是 F05 本身。异步补写无法保证「改了必有痕」，
  而「有痕」是版本历史与撤销功能的地基。
- **用一把数据库锁或 Redis 锁序列化同一简历的写入** — 能避免 CAS 冲突，
  对客户端更友好（不必重试）。否决原因：引入新的共享状态与失效语义（锁租约、
  进程崩溃后的锁释放），而 CAS 已经能给出正确结果。plan 也明确不新增队列或服务。
- **身份初始化复用 revision CAS（推进 revision）** — 实现更统一，所有写入共用一套
  守卫。否决原因：会让编辑器在用户什么都没做的情况下收到一次冲突提示，
  是「为了实现方便而制造用户可见的假象」。

## Consequences

- **收益**：不再存在「改了但没历史」的窗口；重试不会重复修改；并发提交只有一个
  成功且有明确回执；「已保存」有了可查询的凭据（`resume_mutation` 行）。
  真实数据库验证：原子性、幂等、CAS 并发、故障注入回滚、身份并发初始化、
  条件撤销共 29 个集成测试通过。
- **代价与已知上限**：单条 CTE 比多条语句更难读，字段增删必须同时改 SQL 与
  TypeScript 参数对象（两处对齐才能编译通过）。首期冲突策略是**严格返回冲突**，
  不做「不相交目标自动 rebase」——即两个标签页改不同字段也会有一方收到冲突提示，
  需要用户重试。契约把 rebase 列为后续工作。
- **什么信号发生时该重访**：若「不相交字段也被判冲突」的反馈明显影响可用性，
  应在同一提交模块内实现有条件 rebase（而不是放宽 CAS）。若将来迁移到支持交互式
  事务的驱动，可以重新评估 CTE 与显式事务的取舍。

## Verification

- 实现：`apps/web/lib/resume-mutations/{store,commit,identity-store}.ts`、
  迁移 `apps/web/db/migrations/0014_add_resume_mutations.sql`。
- 结构断言（无数据库）：`apps/web/tests/unit/resume-mutation-commit.test.ts`。
- 真实数据库：`apps/web/tests/integration/`（`harness` / `resume-mutation-commit` /
  `resume-mutation-identity-cas`），共 29 个用例，覆盖事务回滚、CAS 并发、
  幂等重放、故障注入、内容 CAS 交错、条件撤销。

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/resume-mutation-commit.test.ts
TEST_DATABASE_URL=<隔离测试库> pnpm --filter @intro-builder/web test:integration
```

集成测试**只接受 `TEST_DATABASE_URL`**，拒绝回退到 `DATABASE_URL`，也拒绝两者相同。
每个测试文件建一个独立数据库，用完 `DROP DATABASE ... WITH (FORCE)`。
