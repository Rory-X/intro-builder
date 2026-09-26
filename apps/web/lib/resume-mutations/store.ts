import { sql, type SQL } from "drizzle-orm";

/**
 * 单条参数化 CTE：原子完成「CAS 更新正文 + 写修订快照 + 写幂等回执 + 写 outbox 事件」。
 *
 * 为什么必须是**一条** SQL（契约 §4）：
 *
 * - 两三条独立 SQL 会留下「正文已改、回执没写」的半应用窗口 —— 那正是 F05
 *   「保存成功但没历史」的成因。
 * - Neon HTTP 驱动**不支持** `db.transaction(callback)`（交互式事务会直接抛错），
 *   所以「开事务、逐条执行、再提交」这条路在该驱动上不可用。
 * - 一条语句内的多个 CTE 共享同一快照、同一原子性：任一插入失败整条回滚，
 *   不需要显式 ROLLBACK。
 *
 * 因果链：只有 `UPDATE ... RETURNING` 真的返回了行，后续 CTE 才有数据可插入。
 * 更新 0 行时，`updated` 为空 → `version_inserted` / `receipt` / `event` 全部为空，
 * 语句不会假装成功。这是「不无痕提交」的机械保证。
 *
 * 参数全部走 `sql` 模板（参数化），不做字符串拼接；正文不写进日志。
 */

export type CommitSqlParams = {
  resumeId: string;
  userId: string;
  expectedRevision: number;
  /** 新正文（JSON 字符串）。 */
  nextContentJson: string;
  /** 新 revision = expectedRevision + 1。 */
  nextRevision: number;
  /** 行的列变更；未提供则保持原值（COALESCE 语义）。 */
  nextTitle: string | null;
  nextTemplateId: string | null;
  mutationId: string;
  /**
   * 回执行的**主键**。不能复用 mutationId：幂等键的语义是
   * UNIQUE(resumeId, mutationId)，即 mutationId 只在**单份简历内**唯一。
   * 两个用户各自用 "m-1" 是很正常的事，复用会让第二条提交撞主键。
   */
  mutationRowId: string;
  requestHash: string;
  operationIdsJson: string;
  /** operationIds 的条数。由调用方算好，避免在 SQL 模板里做 JSON 解析。 */
  operationCount: number;
  beforeJson: string;
  afterJson: string;
  source: string;
  actorName: string;
  summary: string | null;
  undoOf: string | null;
  changeSetId: string | null;
  changeSetVersion: number | null;
  decisionId: string | null;
  versionId: string;
  eventId: string;
  runId: string | null;
  /**
   * Run 的 fencing 令牌。给出时，提交语句会**在同一条 SQL 内**再核验一次
   * 「该 Run 仍可写」（fenceToken 匹配、未取消、未终态）。
   *
   * 为什么必须在提交语句里核验，而不是靠调用方「写之前查一次」：
   * 取消与提交可能并发，查与写之间的窗口足以让一次已取消的修改落库。
   * 只有把条件放进 UPDATE 的 WHERE，才能让数据库成为唯一的裁决者。
   */
  fenceRunId: string | null | undefined;
  fenceToken: number | null | undefined;
};

export type CommitSqlRow = {
  revision: number;
  version_id: string;
  mutation_row_id: string;
  receipt_mutation_id: string;
  event_id: string;
};

/**
 * 构建提交语句。
 *
 * 返回的是一个 `SQL`（drizzle 会参数化它），而不是字符串拼接的结果。
 */
export function buildCommitStatement(p: CommitSqlParams): SQL {
  /*
   * Run fencing：把「该 Run 仍可写」变成 UPDATE 的**连接条件**。
   *
   * 有 fence 时用 `UPDATE ... FROM fence_ok`：若 Run 已取消/被接管/已终态，
   * `fence_ok` 为空集 → 连不出任何行 → 更新 0 行 → 后续依赖 `updated` 的 CTE
   * 也全为空。于是「已取消的 Run 不得提交」由**单条语句**保证，
   * 不依赖调用方在查与写之间做任何时序假设（契约对 P04 任务 4 的明确要求）。
   *
   * 无 fence（普通手动编辑/恢复，不属于任何 Run）时走不带 FROM 的分支。
   */
  /*
   * 用类型判断而不是 `!== null`：调用方漏传时是 `undefined`，而
   * `undefined !== null` 为 **true**，会生成带 `undefined` 的 fence 条件并
   * 静默失效（实测被 P02 的结构断言抓到）。
   */
  const hasFence = typeof p.fenceRunId === "string" && typeof p.fenceToken === "number";

  const updateClause = hasFence
    ? sql`UPDATE "resume"
         SET content    = ${p.nextContentJson}::jsonb,
             title      = COALESCE(${p.nextTitle}, title),
             "templateId" = COALESCE(${p.nextTemplateId}, "templateId"),
             revision   = ${p.nextRevision},
             "updatedAt" = now()
        FROM fence_ok
       WHERE "resume".id = ${p.resumeId}
         AND "resume"."userId" = ${p.userId}
         AND "resume".revision = ${p.expectedRevision}`
    : sql`UPDATE "resume"
         SET content    = ${p.nextContentJson}::jsonb,
             title      = COALESCE(${p.nextTitle}, title),
             "templateId" = COALESCE(${p.nextTemplateId}, "templateId"),
             revision   = ${p.nextRevision},
             "updatedAt" = now()
       WHERE id = ${p.resumeId}
         AND "userId" = ${p.userId}
         AND revision = ${p.expectedRevision}`;

  /*
   * `fence_ok` 必须定义在 `updated` **之前**：PostgreSQL 的 CTE 只能引用
   * 在其之前定义的 CTE（后向引用会报 relation does not exist）。
   */
  const fenceFirst = hasFence
    ? sql`fence_ok AS (
      SELECT 1 AS ok FROM "ai_run"
       WHERE id = ${p.fenceRunId}
         AND "fenceToken" = ${p.fenceToken}
         AND "cancelRequestedAt" IS NULL
         AND status NOT IN ('completed', 'failed', 'cancelled')
    ),`
    : sql``;

  return sql`
    WITH ${fenceFirst} updated AS (
      ${updateClause}
      RETURNING id, revision, content, title, "templateId"
    ),
    version_inserted AS (
      INSERT INTO "resume_version"
        ("id", "resumeId", "userId", title, "templateId", content, source, "actorName",
         "operationCount", summary, revision, "fromRevision", "changeSetId", "runId",
         "sourceDetail", "mutationId")
      SELECT ${p.versionId}, u.id, ${p.userId}, u.title, u."templateId", u.content,
             ${p.source}, ${p.actorName},
             ${p.operationCount},
             ${p.summary}, u.revision, ${p.expectedRevision},
             ${p.changeSetId}, ${p.runId}, ${p.source}, ${p.mutationId}
        FROM updated u
      RETURNING id
    ),
    receipt AS (
      INSERT INTO "resume_mutation"
        ("id", "mutationId", "resumeId", "userId", "requestHash", "operationIds",
         "beforeJson", "afterJson", revision, "versionId", source, "actorName",
         summary, "undoOf", "changeSetId", "changeSetVersion", "decisionId")
      SELECT ${p.mutationRowId}, ${p.mutationId}, u.id, ${p.userId}, ${p.requestHash},
             ${p.operationIdsJson}::jsonb, ${p.beforeJson}::jsonb, ${p.afterJson}::jsonb,
             u.revision, v.id, ${p.source}, ${p.actorName},
             ${p.summary}, ${p.undoOf}, ${p.changeSetId}, ${p.changeSetVersion}, ${p.decisionId}
        FROM updated u
        JOIN version_inserted v ON true
      RETURNING id
    ),
    event_inserted AS (
      INSERT INTO "resume_mutation_event"
        ("eventId", "mutationId", "resumeId", "runId", type, payload)
      SELECT ${p.eventId}, ${p.mutationId}, u.id, ${p.runId}, 'mutation.committed',
             jsonb_build_object(
               'schemaVersion', 1,
               'eventId', ${p.eventId}::text,
               'mutationId', ${p.mutationId}::text,
               'resumeId', u.id,
               'runId', ${p.runId}::text,
               'revision', u.revision,
               'fromRevision', ${p.expectedRevision}::int,
               'versionId', v.id,
               'operationIds', ${p.operationIdsJson}::jsonb,
               'source', ${p.source}::text,
               'actorName', ${p.actorName}::text,
               'changeSetId', ${p.changeSetId}::text
             )
        FROM updated u
        JOIN version_inserted v ON true
      RETURNING "eventId"
    )
    SELECT u.revision        AS revision,
           v.id              AS version_id,
           r.id              AS mutation_row_id,
           ${p.mutationId}   AS receipt_mutation_id,
           e."eventId"       AS event_id
      FROM updated u
      JOIN version_inserted v ON true
      JOIN receipt r ON true
      JOIN event_inserted e ON true
  `;
}

/**
 * 读取幂等回执。
 *
 * 用途：CAS 更新 0 行之后**必须用一条新语句重新查询**，以区分两种情况：
 * - 已有同 `mutationId` 的回执 → 上次其实提交成功了（响应丢失），返回原回执；
 * - 没有回执 → 真的是 revision 冲突。
 *
 * 不能在原语句里 `UNION` 查询回执：同一条语句处于同一 MVCC 快照，看不到
 * 「另一个并发事务刚提交、但快照更早」的行，会把「已经提交」误报成「重复失败」。
 */
export function buildReceiptLookupStatement(
  resumeId: string,
  mutationId: string,
  /**
   * 提交者的 userId。**必须**传入并在查询里核验：
   * 回执查询发生在 ownership 校验之前，若不在这里限定归属，
   * 越权者只需知道 resumeId + mutationId 就能读到他人回执
   * （含真实 revision / versionId / eventId / committedAt）—— 实测可复现。
   */
  userId?: string,
): SQL {
  const ownership =
    typeof userId === "string"
      ? sql` AND EXISTS (
          SELECT 1 FROM "resume" r WHERE r.id = m."resumeId" AND r."userId" = ${userId}
        )`
      : sql``;
  return sql`
    SELECT "mutationId", revision, "versionId", "operationIds", "requestHash",
           "changeSetId", "createdAt",
           (SELECT "eventId" FROM "resume_mutation_event" e
             WHERE e."resumeId" = m."resumeId" AND e."mutationId" = m."mutationId") AS "eventId"
      FROM "resume_mutation" m
     WHERE m."resumeId" = ${resumeId} AND m."mutationId" = ${mutationId}${ownership}
     LIMIT 1
  `;
}

/** 读取当前 revision（冲突时告知客户端真实值）。 */
export function buildRevisionLookupStatement(resumeId: string, userId: string): SQL {
  return sql`
    SELECT revision FROM "resume" WHERE id = ${resumeId} AND "userId" = ${userId} LIMIT 1
  `;
}
