import { sql, type SQL } from "drizzle-orm";
import type { RunEventEnvelope } from "@intro-builder/shared/types";

/**
 * 运行与事件的**持久化**语句（P04 任务 1）。
 *
 * 与文档提交同样的原则：把「需要原子性的判断」放进**单条 SQL**，而不是
 * 「先查后写」。lease 的获取尤其如此 —— 两个并发 start 若各自「先查是否空闲、
 * 再写入租约」，就会出现双持有者；用条件 UPDATE 让只有一个能改到行。
 *
 * 这里只放 SQL 构建，业务编排在 `run-store.ts`。
 */

/**
 * 分配下一个 sequence 并写入事件。
 *
 * sequence 由**数据库**在该语句内算出（`MAX(sequence)+1`），因此：
 * - 跨实例天然有序，不依赖任何进程内自增；
 * - 唯一索引 `(runId, sequence)` 会在竞争时让其中一方失败，而不是静默重号。
 */
export function buildAppendEventStatement(event: RunEventEnvelope, sourceEventId: string | null): SQL {
  return sql`
    INSERT INTO "ai_run_event"
      ("eventId", "runId", "attemptId", "sequence", "type", "payload", "sourceEventId", "occurredAt")
    VALUES (
      ${event.eventId},
      ${event.runId},
      ${event.attemptId},
      ${event.sequence},
      ${event.type},
      ${JSON.stringify(event.payload)}::jsonb,
      ${sourceEventId},
      ${event.occurredAt}::timestamptz
    )
  `;
}

/**
 * 读取当前最大 sequence。仅在**非并发**场景（恢复/诊断）使用。
 * 写入事件请用 `buildInsertEventWithSequenceStatement`。
 */
export function buildNextSequenceStatement(runId: string): SQL {
  return sql`
    SELECT COALESCE(MAX("sequence"), 0) AS "maxSequence" FROM "ai_run_event" WHERE "runId" = ${runId}
  `;
}

/**
 * 获取写 Run 的 lease。
 *
 * 条件 UPDATE，只有一个调用者能改到行：
 * - Run 属于该用户与该简历；
 * - Run 尚未处于终态；
 * - 要么没有活跃租约，要么租约已过期（可以接管）。
 *
 * 接管时 `fenceToken + 1`：旧持有者的 token 随即失效，它晚到的提交会被拒绝。
 */
export function buildAcquireLeaseStatement(params: {
  runId: string;
  userId: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
}): SQL {
  return sql`
    UPDATE "ai_run"
       SET "leaseOwner" = ${params.leaseOwner},
           "leaseExpiresAt" = ${params.leaseExpiresAt.toISOString()}::timestamptz,
           "fenceToken" = "fenceToken" + 1,
           "updatedAt" = now()
     WHERE id = ${params.runId}
       AND "userId" = ${params.userId}
       AND status NOT IN ('completed', 'failed', 'cancelled')
       AND ("leaseOwner" IS NULL OR "leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
    RETURNING id, "fenceToken", "leaseExpiresAt"
  `;
}

/** 续租：只有当前持有者能续，且不得续一个已被取消的 Run。 */
export function buildRenewLeaseStatement(params: {
  runId: string;
  leaseOwner: string;
  fenceToken: number;
  leaseExpiresAt: Date;
}): SQL {
  return sql`
    UPDATE "ai_run"
       SET "leaseExpiresAt" = ${params.leaseExpiresAt.toISOString()}::timestamptz,
           "updatedAt" = now()
     WHERE id = ${params.runId}
       AND "leaseOwner" = ${params.leaseOwner}
       AND "fenceToken" = ${params.fenceToken}
       AND "cancelRequestedAt" IS NULL
       AND status NOT IN ('completed', 'failed', 'cancelled')
    RETURNING id
  `;
}

/** 释放租约（attempt 结束时调用，让后续 continue 可以接管）。 */
export function buildReleaseLeaseStatement(params: { runId: string; fenceToken: number }): SQL {
  return sql`
    UPDATE "ai_run"
       SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
     WHERE id = ${params.runId} AND "fenceToken" = ${params.fenceToken}
    RETURNING id
  `;
}

/**
 * 按 requestId 幂等创建 Run。
 *
 * `ON CONFLICT DO NOTHING` + 随后的读取，让「重复的 start 请求」复用同一个 Run，
 * 不会二次调用模型。注意：这不等于允许静默失败 —— 调用方必须读到已存在的 Run
 * （见 run-store 的 startRun）。
 */
export function buildInsertRunStatement(params: {
  id: string;
  userId: string;
  resumeId: string;
  sessionId: string | null;
  requestId: string;
  mode: string;
  writeMode: string;
  promptVersion: string | null;
  modelId: string | null;
  deadlineAt: Date | null;
}): SQL {
  return sql`
    INSERT INTO "ai_run"
      ("id", "userId", "resumeId", "sessionId", "requestId", "status", "mode", "writeMode",
       "promptVersion", "modelId", "deadlineAt")
    VALUES (
      ${params.id}, ${params.userId}, ${params.resumeId}, ${params.sessionId}, ${params.requestId},
      'running', ${params.mode}, ${params.writeMode},
      ${params.promptVersion}, ${params.modelId},
      ${params.deadlineAt ? params.deadlineAt.toISOString() : null}::timestamptz
    )
    ON CONFLICT ("userId", "requestId") DO NOTHING
    RETURNING id, status, "fenceToken", "checkpointVersion"
  `;
}

/** 读取 Run（含归属校验所需的字段）。 */
export function buildGetRunStatement(runId: string): SQL {
  return sql`
    SELECT id, "userId", "resumeId", "sessionId", "requestId", status, mode, "writeMode",
           "leaseOwner", "leaseExpiresAt", "fenceToken", "cancelRequestedAt", "deadlineAt",
           "startedAt", "finishedAt", "checkpointVersion", checkpoint, "promptVersion",
           "modelId", usage, "parentRunId", "lastError"
      FROM "ai_run" WHERE id = ${runId} LIMIT 1
  `;
}

/** 按 (userId, requestId) 读取既有 Run，用于 start 幂等。 */
export function buildGetRunByRequestStatement(userId: string, requestId: string): SQL {
  return sql`
    SELECT id, status, "fenceToken", "checkpointVersion"
      FROM "ai_run" WHERE "userId" = ${userId} AND "requestId" = ${requestId} LIMIT 1
  `;
}

/**
 * 读取同一简历当前活跃的写 Run。
 *
 * 用于「同一简历同一时刻只允许一个写 Run」：若已有活跃 Run 且它的租约仍然有效，
 * 新的 start 必须被拒绝，而不是并排跑两个。
 */
export function buildActiveRunForResumeStatement(resumeId: string): SQL {
  return sql`
    SELECT id, status, "leaseOwner", "leaseExpiresAt", "fenceToken", "startedAt"
      FROM "ai_run"
     WHERE "resumeId" = ${resumeId}
       AND status IN ('running', 'waiting_user')
       AND "leaseExpiresAt" IS NOT NULL
       AND "leaseExpiresAt" > now()
     ORDER BY "startedAt" DESC
     LIMIT 1
  `;
}

/**
 * 写入 Run 的终态。
 *
 * 条件里带 `status NOT IN (终态)`，因此「终态只能出现一次」由数据库保证：
 * 两个并发结束写只有一个能改到行，另一个拿到 0 行。
 */
export function buildFinishRunStatement(params: {
  runId: string;
  status: "completed" | "failed" | "cancelled" | "interrupted" | "waiting_user";
  lastError?: string | null;
}): SQL {
  const isTerminal = (["completed", "failed", "cancelled"] as string[]).includes(params.status);
  /*
   * `finishedAt` 的两个分支必须写成**两段不同的 SQL 文本**。
   *
   * 把 `sql\`now()\`` / `sql\`"finishedAt"\`` 作为参数嵌进模板会被参数化成占位符
   * （渲染为 $n），两种状态生成出**逐字节相同**的语句 —— 于是 waiting_user 也会
   * 把 finishedAt 设成 now()，把「等待用户」误记成任务已结束。
   * 因此这里用显式拼接区分，并由单测锁住这个差异。
   */
  const finishedAtClause = isTerminal ? sql.raw("now()") : sql.raw('"finishedAt"');
  return sql`
    UPDATE "ai_run"
       SET status = ${params.status},
           "lastError" = COALESCE(${params.lastError ?? null}, "lastError"),
           "finishedAt" = ${finishedAtClause},
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "updatedAt" = now()
     WHERE id = ${params.runId}
       AND status NOT IN ('completed', 'failed', 'cancelled')
    RETURNING id, status
  `;
}

/** 持久化取消意图。幂等：重复取消不报错，也不覆盖首次时间。 */
export function buildRequestCancelStatement(runId: string): SQL {
  return sql`
    UPDATE "ai_run"
       SET "cancelRequestedAt" = COALESCE("cancelRequestedAt", now()),
           "updatedAt" = now()
     WHERE id = ${runId}
       AND status NOT IN ('completed', 'failed', 'cancelled')
    RETURNING id, status, "cancelRequestedAt"
  `;
}

/**
 * 检查 fencing 与取消状态 —— **提交前**再核验一次。
 *
 * 不能只在模型开始时验一次：cancel 与 commit 可能并发，只有写库前的这次核验
 * 才能确定先后顺序。返回空表示该 Run 已不应继续写入。
 */
export function buildAssertWritableStatement(params: {
  runId: string;
  fenceToken: number;
}): SQL {
  return sql`
    SELECT id, status, "fenceToken", "cancelRequestedAt"
      FROM "ai_run"
     WHERE id = ${params.runId}
       AND "fenceToken" = ${params.fenceToken}
       AND "cancelRequestedAt" IS NULL
       AND status NOT IN ('completed', 'failed', 'cancelled')
     LIMIT 1
  `;
}

/** 记录工具账目（开始）。重试命中已有记录时由调用方读取既有结果。 */
export function buildStartToolExecutionStatement(params: {
  id: string;
  runId: string;
  attemptId: string;
  toolCallId: string;
  toolName: string;
  inputHash: string;
}): SQL {
  return sql`
    INSERT INTO "ai_tool_execution"
      ("id", "runId", "attemptId", "toolCallId", "toolName", "inputHash", "status")
    VALUES (${params.id}, ${params.runId}, ${params.attemptId}, ${params.toolCallId},
            ${params.toolName}, ${params.inputHash}, 'running')
    ON CONFLICT ("runId", "attemptId", "toolCallId") DO NOTHING
    RETURNING id
  `;
}

/** 完成工具账目，并记录与文档提交的关联。 */
export function buildFinishToolExecutionStatement(params: {
  runId: string;
  attemptId: string;
  toolCallId: string;
  status: "succeeded" | "failed" | "interrupted";
  result: Record<string, unknown> | null;
  mutationId?: string | null;
  changeSetId?: string | null;
  errorCode?: string | null;
}): SQL {
  return sql`
    UPDATE "ai_tool_execution"
       SET status = ${params.status},
           result = ${params.result ? JSON.stringify(params.result) : null}::jsonb,
           "mutationId" = ${params.mutationId ?? null},
           "changeSetId" = ${params.changeSetId ?? null},
           "errorCode" = ${params.errorCode ?? null},
           "finishedAt" = now()
     WHERE "runId" = ${params.runId}
       AND "attemptId" = ${params.attemptId}
       AND "toolCallId" = ${params.toolCallId}
    RETURNING id
  `;
}

/** 读取该 Run 已完成的工具账本（恢复时用来避免重放已成功的写操作）。 */
export function buildListToolExecutionsStatement(runId: string): SQL {
  return sql`
    SELECT "attemptId", "toolCallId", "toolName", "inputHash", status, result,
           "mutationId", "changeSetId", "errorCode"
      FROM "ai_tool_execution"
     WHERE "runId" = ${runId}
     ORDER BY "startedAt" ASC
  `;
}

/** 读取事件（分页）。只有作者可读 —— 归属校验在调用方。 */
export function buildListEventsStatement(params: { runId: string; afterSequence: number; limit: number }): SQL {
  return sql`
    SELECT "eventId", "runId", "attemptId", "sequence", "type", "payload", "sourceEventId", "occurredAt"
      FROM "ai_run_event"
     WHERE "runId" = ${params.runId} AND "sequence" > ${params.afterSequence}
     ORDER BY "sequence" ASC
     LIMIT ${params.limit}
  `;
}

/** 事件类型列表，供恢复时判断 attempt 是否已给出结束结果。 */
export function buildAttemptEndLookupStatement(params: { runId: string; attemptId: string }): SQL {
  return sql`
    SELECT type FROM "ai_run_event"
     WHERE "runId" = ${params.runId}
       AND "attemptId" = ${params.attemptId}
       AND type IN ('run.waiting_user','run.interrupted','run.completed','run.failed','run.cancelled')
     ORDER BY "sequence" ASC
     LIMIT 1
  `;
}

/**
 * 取当前 attempt 的结束事件类型（**不限 attemptId**）。
 *
 * 用于「平台硬杀后识别 interrupted」：进程被杀时不写任何结束事件，
 * 因此需要回答「这个 Run 有没有任何 attempt 给出过结束事件」。
 * 与 `buildAttemptEndLookupStatement` 的区别是后者按 attemptId 精确查
 * （那是给「某个具体 attempt 结束时」用的），这里要的是全局最近一条。
 */
export function buildLatestAttemptEndStatement(runId: string): SQL {
  return sql`
    SELECT type FROM "ai_run_event"
     WHERE "runId" = ${runId}
       AND type IN ('run.waiting_user','run.interrupted','run.completed','run.failed','run.cancelled')
     ORDER BY "sequence" DESC
     LIMIT 1
  `;
}

/**
 * 把「租约已过期、且没有结束事件」的 Run 标记为 interrupted。
 *
 * 条件刻意收紧，三条缺一不可：
 *
 * - `status NOT IN (终态)`：终态只能出现一次，绝不覆盖；
 * - `"leaseExpiresAt" < now()`：**这是「进程确实死了」的唯一可靠信号**。
 *   AbortSignal 在硬杀时不会触发，内存标志随进程消失，只有数据库里的租约
 *   过期能跨越进程存活下来；
 * - `cancelRequestedAt IS NULL`：用户主动取消走 `requestCancel` → `cancelled`，
 *   不该被这里改写成 interrupted。
 *
 * 用 `FOR UPDATE` 会与并发 acquireLease 争锁，因此这里**不用**；
 * 条件 UPDATE 本身是原子的，且即使与新的 acquireLease 竞争，两者都对
 * 「过期」这一事实做判断，结果一致。
 */
export function buildMarkInterruptedOnExpiredLeaseStatement(params: {
  runId: string;
  status: string;
  lastError: string | null;
}): SQL {
  return sql`
    UPDATE "ai_run"
       SET status = ${params.status},
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "finishedAt" = now(),
           "lastError" = ${params.lastError},
           "updatedAt" = now()
     WHERE id = ${params.runId}
       AND status NOT IN ('completed', 'failed', 'cancelled')
       AND "cancelRequestedAt" IS NULL
       AND "leaseOwner" IS NOT NULL
       AND "leaseExpiresAt" IS NOT NULL
       AND "leaseExpiresAt" < now()
    RETURNING id, status
  `;
}

/** 把 outbox 事件投影为 ai_run_event（按 sourceEventId 去重）。 */
export function buildProjectMutationEventStatement(params: {
  eventId: string;
  runId: string;
  attemptId: string;
  sequence: number;
  sourceEventId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}): SQL {
  return sql`
    INSERT INTO "ai_run_event"
      ("eventId", "runId", "attemptId", "sequence", "type", "payload", "sourceEventId", "occurredAt")
    VALUES (${params.eventId}, ${params.runId}, ${params.attemptId}, ${params.sequence},
            'mutation.committed', ${JSON.stringify(params.payload)}::jsonb,
            ${params.sourceEventId}, ${params.occurredAt}::timestamptz)
    ON CONFLICT ("sourceEventId") DO NOTHING
    RETURNING "eventId"
  `;
}

/** 尚未投影到该 Run 的 outbox 事件（恢复前补齐遗漏）。 */
export function buildUnprojectedMutationsStatement(runId: string): SQL {
  return sql`
    SELECT e."eventId", e."mutationId", e.payload, e."createdAt", e."resumeId"
      FROM "resume_mutation_event" e
     WHERE e."runId" = ${runId}
       AND NOT EXISTS (
         SELECT 1 FROM "ai_run_event" r WHERE r."sourceEventId" = e."eventId"
       )
     ORDER BY e."createdAt" ASC
  `;
}


/**
 * 在**单条语句**里原子取号并写入事件。
 *
 * 演进过程（三步都实测过，下一位不要重走）：
 * 1. **「先读 MAX 再插入」**（两条语句）→ 8 路并发时落败方反复重试仍耗尽次数，
 *    事件**直接丢失**（丢的可能是 mutation.committed，UI 会永远显示「未保存」）。
 * 2. **把 MAX 与 INSERT 放进同一个 CTE** → 仍然撞唯一键。原因是语句快照在
 *    加锁之前就已确定，并发语句的 `allocated` 子查询看到同一份快照，
 *    于是算出同一个序号。`FOR UPDATE` 与 `pg_advisory_xact_lock` 都救不了。
 * 3. **用 `ai_run.eventSequence` 作计数器列**（当前方案）：
 *    `UPDATE ... SET "eventSequence" = "eventSequence" + 1 RETURNING "eventSequence"`
 *    对同一行加行级锁，并在锁内重新读取当前值 —— 这才是真正的串行化点。
 *    取号与插入在同一语句内完成，因此不会出现「取到号但插入失败」的空洞。
 */
export function buildInsertEventWithSequenceStatement(
  event: Omit<RunEventEnvelope, "sequence">,
  sourceEventId: string | null,
): SQL {
  return sql`
    WITH allocated AS (
      UPDATE "ai_run"
         SET "eventSequence" = "eventSequence" + 1
       WHERE id = ${event.runId}
      RETURNING "eventSequence" AS next_sequence
    ),
    inserted AS (
      INSERT INTO "ai_run_event"
        ("eventId", "runId", "attemptId", "sequence", "type", "payload", "sourceEventId", "occurredAt")
      SELECT ${event.eventId}, ${event.runId}, ${event.attemptId}, a.next_sequence,
             ${event.type}, ${JSON.stringify(event.payload)}::jsonb, ${sourceEventId},
             ${event.occurredAt}::timestamptz
        FROM allocated a
      RETURNING "sequence"
    )
    SELECT "sequence" FROM inserted
  `;
}

/** outbox 投影：同样在单条语句里分配 sequence，并按 sourceEventId 去重。 */
export function buildProjectMutationEventWithSequenceStatement(params: {
  eventId: string;
  runId: string;
  attemptId: string;
  sourceEventId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}): SQL {
  /*
   * 取号必须**只在确实需要插入时**发生。
   *
   * 此前是「先取号、再 ON CONFLICT DO NOTHING」：去重命中时号已经被消耗，
   * 于是 eventSequence 会跳号（实测并发投影同一源事件 → 库里 sequence=1 而计数器=2）。
   * 序号本身仍单调、去重仍正确，但「无缺口」这一措辞就不成立了。
   *
   * 修法：把 `allocated` 的 UPDATE 与 `needs_projection` 连接 —— 若该源事件
   * 已被投影，`needs_projection` 为空集 → UPDATE 影响 0 行 → **不消耗序号**。
   *
   * `ON CONFLICT ... DO NOTHING` 保留为并发兜底：两个请求同时通过上面的存在性检查时，
   * 仍只有一个能插入（另一个不插入，但它已经消耗了一个序号）。
   * 这个残留窗口**只影响序号连续性，不影响顺序与去重正确性**，如实记录在此。
   * 该唯一索引是部分索引，`ON CONFLICT` 必须复述同一谓词，否则抛 42P10。
   */
  return sql`
    WITH needs_projection AS (
      SELECT 1 AS needed
       WHERE NOT EXISTS (
         SELECT 1 FROM "ai_run_event" e WHERE e."sourceEventId" = ${params.sourceEventId}
       )
    ),
    allocated AS (
      UPDATE "ai_run"
         SET "eventSequence" = "eventSequence" + 1
        FROM needs_projection
       WHERE id = ${params.runId}
      RETURNING "eventSequence" AS next_sequence
    ),
    inserted AS (
      INSERT INTO "ai_run_event"
        ("eventId", "runId", "attemptId", "sequence", "type", "payload", "sourceEventId", "occurredAt")
      SELECT ${params.eventId}, ${params.runId}, ${params.attemptId}, a.next_sequence,
             'mutation.committed', ${JSON.stringify(params.payload)}::jsonb,
             ${params.sourceEventId}, ${params.occurredAt}::timestamptz
        FROM allocated a
      ON CONFLICT ("sourceEventId") WHERE "sourceEventId" IS NOT NULL DO NOTHING
      RETURNING "sequence"
    )
    SELECT "sequence" FROM inserted
  `;
}
