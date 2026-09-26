# P02：原子提交、修订与幂等回执

状态：**已完成**（2026-09-26）。依赖 P01。交付完整文档提交模块，P03 才切换所有 UI writer。

## 完成记录

- **落地**：迁移 `0014_add_resume_mutations.sql`（additive）；`lib/resume-mutations/`
  的 `store.ts`（单条 CTE）、`commit.ts`（唯一写入口）、`identity-store.ts`（内容 CAS）；
  隔离数据库集成测试 `tests/integration/`（3 文件 29 用例）。
- **关键决定与取舍**：见
  [决策笔记](../../notes/implemented/architecture/2026-09-26-atomic-resume-mutation-commit.md)。
- **验证**：`pnpm test`（118 文件 / 745 测试）、`pnpm typecheck`、`pnpm lint`
  （0 error，warning 与基线同为 12）、`pnpm build`、`pnpm notes:verify` 全通过；
  `test:integration` 29/29 通过（真实 PostgreSQL，含故障注入与并发）。
- **未做（归 P03）**：所有 UI writer 仍走旧 `saveResume`。提交模块已就绪但尚未接线，
  因此新链路**未切流**。

### 隔离测试库怎么跑（实测可复现）

本机既有的 Postgres（5432）`max_connections=100`，被用户正在运行的 `next dev`
（PID 21032）占满约 100 条连接。**不要**重启或改动用户那个实例（同机还跑着别的业务）。
正确做法是另起一个临时实例：

```bash
PGDATA=/tmp/ib-pg-test
rm -rf "$PGDATA" && mkdir -p "$PGDATA"
LANG=C LC_ALL=C /opt/homebrew/opt/postgresql@16/bin/initdb \
  -D "$PGDATA" -U "$(whoami)" --auth=trust --locale=C --encoding=UTF8
LANG=C LC_ALL=C /opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$PGDATA" \
  -o "-p 55432 -c max_connections=200 -k /tmp" -l /tmp/ib-pg.log start
/opt/homebrew/opt/postgresql@16/bin/createdb -h /tmp -p 55432 -U "$(whoami)" intro_builder_test

cd apps/web
TEST_DATABASE_URL="postgresql://$(whoami)@localhost:55432/intro_builder_test" pnpm test:integration
```

`initdb` 必须显式给 `--locale=C`（当前 shell 的 `LANG`/`LC_*` 会让它报「无效的本地化设置」）。

### 实测发现（下一位不要重踩）

1. **不能按 schema 隔离**：迁移 SQL 里有 Drizzle 生成的硬编码跨表外键
   （`REFERENCES "public"."user"`），隔离 schema 下基础表建不起来，首个迁移即失败。
   改为**每个测试文件一个独立数据库**。
2. **`search_path` 必须在连接建立时设置**：postgres.js 是连接池，事后 `SET` 只作用于
   被选中的那一条连接。改用独立数据库后此问题自然消失。
3. **`mutationId` 只在单份简历内唯一**：回执行主键与 outbox 唯一键都**不能**只按
   `mutationId`（两个用户各自用 `"m-1"` 是常态，会互相撞主键），两处都必须带 `resumeId`。
4. **`readBase` 必须带 `userId` 过滤**：只按 `id` 查会让越权提交拿到 `conflict`
   （说明简历存在），等于泄露资源存在性；必须 `not_found` → `rejected`。
5. **身份初始化不能用 revision 做 CAS**（它刻意不推进 revision），必须用内容 CAS，
   且失败后要重读以区分「并发赢家已写入」与「期间发生真实编辑」。

## 独立模型复核记录

复核人：`deepseek-v4-flash-ioa`（tt 提供方），2026-09-26。只读复核，未修改仓库。

> **覆盖度说明**：本切片原本计划请两个不同模型各跑一次独立复核；
> `cursor-local` 提供方两次启动均失败且无产出，因此两份已交付的报告同源于一个模型。
> 各条发现均已由我独立复现确认，但「两个独立视角」这一目标未达成。

**判定：成立** —— 复核者原文：「单条 CTE、0 行不插成功记录、幂等、CAS 并发、
故障注入回滚均在真实 PostgreSQL 上通过」。

复核确认成立的部分（真实数据库实测）：
- 正文 + 修订 + 回执 + outbox 在**同一条 SQL**；`UPDATE` 影响 0 行时不插入成功记录。
- 幂等：同 `mutationId` 同 payload 返回**原回执**（原 revision / versionId），异 payload 拒绝。
- CAS 并发：两个同 revision 请求只有一个成功。
- 故障注入（触发器让版本/事件插入失败）：正文完全回滚，无残留成功记录。
- **24 路并发追加事件无重号、无缺口**（sequence 恰好 1..24）。
- 终态并发写入 1+0（终态只出现一次）；lease 并发只有一个赢家。

复核发现并已修复的缺陷：
1. **越权者可读到他人回执**：`lookupReceipt` 在带 `userId` 的 `readBase` **之前**执行，
   命中即返回完整回执（真实 revision / versionId / eventId / committedAt）。
   实测：用他人 `resumeId` + `mutationId` + payload 能拿到受害者回执。
   修法：回执查询带 `userId` 并核验归属（`EXISTS` 子查询），越权返回 `not_found`；
   同时验证归属正确的重试仍能拿到原回执（幂等未被破坏）。
2. **outbox 投影去重会消耗 sequence**（未修，已交接）：`allocated` 先取号、
   `inserted` 再 `ON CONFLICT DO NOTHING`，去重命中时号已消耗 → 序号有缺口。
   不影响顺序与去重正确性，但让「无缺口」这一措辞不成立。

复核者明确指出的**驱动覆盖缺口**：集成测试只跑了 TCP（localhost:55432），
Neon HTTP 驱动路径**未验证**。plan 任务 8 要求「两种驱动都验证，否则必须明说未通过」——
因此本切片的准确表述是**仅 TCP 通过**。

复核者指出的**测试取样偏差**：本切片 16 个集成用例**全走 experience 数组**
（`setCompany`），单例富文本 / styleSettings / 标题 / 模板从未被真实 SQL 验证；
「回执查询」分支也没有越权用例，所以越权读回执逃过了真实数据库验证。

结论：**门禁全绿只说明「已写下的断言成立」，不说明「没有未被想到的缺陷」。**

完整发现与未修项：
[复核发现笔记](../../notes/implemented/bug-fix/2026-09-26-independent-review-findings-p01-p04.md)。

## 文件范围

现有：`apps/web/db/schema.ts`、`db/migrations/meta/_journal.json`、Web 数据库入口、就近 Server Actions 的鉴权帮助函数。
拟新增：下一未使用编号的 additive SQL migration；`apps/web/lib/resume-mutations/{commit,store,read,undo}.ts`；`tests/unit/resume-mutation-commit.test.ts`、隔离数据库集成测试配置与脚本。
不要直接改 Neon/TCP 驱动选择或引入另一个生产 DB client。

## 任务

1. **表结构与迁移。** 添加 resume.revision、mutation、mutation_event(outbox)、changeSet、decision 及新版 version 元数据，规格定义唯一键与外键。旧 version 新字段可空；不把历史前快照当新式后快照。首次启用时建立可恢复 baseline。同步 Drizzle journal 与部署迁移测试，不执行根旧 `db:migrate`。
2. **建立真实事务测试入口。** 新建 `tests/integration/`、独立 Node Vitest config、`test:integration` 脚本；默认单测排除 integration。测试只接受 `TEST_DATABASE_URL`，拒绝与生产 URL 相同；测试创建独立 schema/数据且可清理。不用生产凭据跑破坏性用例。将调用命令写入 plan 验证记录。
3. **实现身份初始化 CAS。** owner 第一次编辑前补 ID 与修订；两个初始化并发只保留一个结果，落后者重新读取。恢复/编辑/新 Run 都拿已持久化 ID。系统初始化留来源记录但不伪装为用户改写。
4. **实现 commit 接口。** 鉴权+ownership→校验请求→读取基准→prepare→单条参数化 CTE 完成正文、after 快照、mutation 回执、业务事件。actor/source 来自可信调用上下文。只暴露业务结果，不让 UI 操心 SQL 顺序。
5. **验证幂等与并发。** 同 ID 同 payload 返回原回执；同 ID 异 payload 拒绝；同 revision 两请求一个成功；响应丢失可查回执；CAS 0 行后新查询检查既有回执。使用真实连接并发执行，禁止仅 mock 各条 SQL 成功来验收。
6. **验证原子失败。** 在修订/回执/事件插入分别注入约束失败，重新通过读取接口检查正文 revision 不变、无残留成功记录。零变更不生成空修订。提交字段不允许越权扩大范围。
7. **实现条件 undo 与恢复准备。** undo 为新 mutation，关联 undoOf；只在当前目标等于被撤销 after 条件时生成 inverse，保留其他目标变化。restore 仍经同一 commit，不能直接 update。测试旧 legacy 快照整体恢复与不可单项撤销提示。
8. **门禁与发布。** focused + integration + 全套 DoD，验证 Neon HTTP 和 TCP 路径都可执行相同 SQL；若只验证了一种必须明确另一种未通过，不能切流。提交建议 `feat(resume): commit content revisions and receipts atomically`。

## 准确性约束

- CTE 的每个成功插入依赖 UPDATE RETURNING；不能 UPDATE 0 行还 INSERT 一条成功版本。
- 同条 SQL 中回执查询可能看不到等待中的另一个事务的新行，需 fresh query 重查，不能误报重复失败。
- 权限、已批准提案版本、Run fencing/cancel 检查在 SQL 写入条件内可再次核验；P04 加运行数据时扩展，不能只在模型开始时验一次。
- 不用 unsafe/raw 字符串拼接用户内容；日志不输出正文。
- `createResumeVersion` 不能保持为任意客户端伪造来源的独立成功留痕入口；P03 将它退出现役写链。

## 命令与退出条件

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/resume-version-actions.test.ts tests/unit/resume-mutation-commit.test.ts tests/unit/db-migrations.test.ts tests/unit/deploy-migrations.test.ts
# 以下是本切片必须先新增的脚本，创建前不存在：
pnpm --filter @intro-builder/web test:integration
```

再跑总门禁。没有隔离数据库或 SQL 原子性证据，状态必须保持「未验收」。回滚只关闭新写入口，保留 additive 表，不执行 drop/down migration。
