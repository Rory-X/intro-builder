import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acquireLease,
  appendEvent,
  finishRun,
  getRun,
  isRunWritable,
  listEvents,
  listToolExecutions,
  readAttemptEndType,
  reconcileMutationEvents,
  releaseLease,
  renewLease,
  requestCancel,
  startRun,
  startToolExecution,
  finishToolExecution,
  toolInputHash,
} from "@/lib/ai/run-store";
import {
  resetRunStoreExecutor,
  setRunStoreExecutorForTesting,
} from "@/lib/ai/run-store";
import { createTestDb, readResumeState, seedResume, type TestDb } from "./helpers/test-db";

/**
 * 运行存储编排层的真实数据库验证（P04 任务 1）。
 *
 * 这些行为无法用 mock 证明：租约的并发竞争、sequence 分配的跨请求单调性、
 * 「终态只出现一次」、取消与提交的先后顺序，都必须在真实 PostgreSQL 上跑。
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb("ai-run-store");
  // 把编排层指向隔离数据库：这样测的是**同一套生产逻辑**在真实 PostgreSQL 上的行为，
  // 而不是 mock 出来的返回值。租约竞争、sequence 分配这类行为只有真库才能证明。
  setRunStoreExecutorForTesting((statement) => testDb.db.execute(statement));
});

afterAll(() => {
  resetRunStoreExecutor();
});

afterAll(async () => {
  await testDb?.dispose();
});

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

async function newRun(overrides: { resumeId?: string; userId?: string } = {}) {
  const { userId, resumeId } = await seedResume(testDb, overrides);
  const started = await startRun({
    id: nextId("run"),
    userId,
    resumeId,
    sessionId: null,
    requestId: nextId("req"),
    mode: "optimize_existing",
    writeMode: "direct",
    modelId: "test-model",
  });
  if (started.status !== "created") throw new Error("expected created");
  return { userId, resumeId, runId: started.runId };
}

describe("Run 创建：幂等", () => {
  it("重复的 start 请求复用同一个 Run（不二次调用模型）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    const requestId = "req-idem";
    const first = await startRun({
      id: nextId("run"),
      userId,
      resumeId,
      sessionId: null,
      requestId,
      mode: "optimize_existing",
      writeMode: "direct",
    });
    const second = await startRun({
      id: nextId("run"),
      userId,
      resumeId,
      sessionId: null,
      requestId,
      mode: "optimize_existing",
      writeMode: "direct",
    });

    expect(first.status).toBe("created");
    expect(second.status).toBe("existing");
    expect(second.runId).toBe(first.runId);

    const runs = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "ai_run" WHERE "userId" = $1 AND "requestId" = $2`,
      [userId, requestId],
    );
    expect(runs[0].n).toBe("1");
  });

  it("不同用户使用相同 requestId 互不影响", async () => {
    const a = await seedResume(testDb);
    const b = await seedResume(testDb);
    const shared = "req-shared";
    const first = await startRun({
      id: nextId("run"), userId: a.userId, resumeId: a.resumeId, sessionId: null,
      requestId: shared, mode: "optimize_existing", writeMode: "direct",
    });
    const second = await startRun({
      id: nextId("run"), userId: b.userId, resumeId: b.resumeId, sessionId: null,
      requestId: shared, mode: "optimize_existing", writeMode: "direct",
    });
    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    expect(second.runId).not.toBe(first.runId);
  });
});

describe("租约：同一简历同时只允许一个写 Run", () => {
  it("两个并发获取只有一个成功", async () => {
    const { runId, userId } = await newRun();
    const [a, b] = await Promise.all([
      acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 }),
      acquireLease({ runId, userId, leaseOwner: "w2", ttlMs: 30_000 }),
    ]);
    const acquired = [a, b].filter((r) => r.status === "acquired");
    expect(acquired).toHaveLength(1);
    const held = [a, b].find((r) => r.status === "held_by_other");
    expect(held).toBeDefined();
  });

  it("租约过期后可以被接管，且 fenceToken 递增（旧持有者被作废）", async () => {
    const { runId, userId } = await newRun();
    const first = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: -1000 });
    if (first.status !== "acquired") throw new Error("expected acquired");

    const second = await acquireLease({ runId, userId, leaseOwner: "w2", ttlMs: 30_000 });
    expect(second.status).toBe("acquired");
    if (second.status !== "acquired") return;
    expect(second.fenceToken).toBeGreaterThan(first.fenceToken);
  });

  it("终态 Run 不能被获取租约（不可复活）", async () => {
    const { runId, userId } = await newRun();
    await finishRun({ runId, status: "completed" });
    const result = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    expect(result.status).toBe("terminal");
  });

  it("续租失败表示租约已失效（被取消/接管/终态）", async () => {
    const { runId, userId } = await newRun();
    const lease = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    if (lease.status !== "acquired") throw new Error("expected acquired");

    expect(await renewLease({ runId, leaseOwner: "w1", fenceToken: lease.fenceToken, ttlMs: 30_000 })).toBe(true);
    await requestCancel(runId);
    expect(await renewLease({ runId, leaseOwner: "w1", fenceToken: lease.fenceToken, ttlMs: 30_000 })).toBe(false);
  });

  it("释放租约后他人可获取", async () => {
    const { runId, userId } = await newRun();
    const lease = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    if (lease.status !== "acquired") throw new Error("expected acquired");
    await releaseLease(runId, lease.fenceToken);
    const again = await acquireLease({ runId, userId, leaseOwner: "w2", ttlMs: 30_000 });
    expect(again.status).toBe("acquired");
  });
});

describe("事件：sequence 由数据库分配且单调", () => {
  it("并发追加事件不产生重号，且顺序严格递增", async () => {
    const { runId } = await newRun();
    // 并发强度刻意设得比修复前失败的场景更高：单语句分配 + 行锁应当完全扛住。
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        appendEvent({
          runId,
          attemptId: "att-1",
          type: "text.delta",
          payload: { i },
          eventId: nextId("evt"),
        }),
      ),
    );
    const events = await listEvents({ runId, limit: 100 });
    expect(events).toHaveLength(24);
    const sequences = events.map((e) => e.sequence);
    // 无重号、无缺口：1..24 恰好各出现一次。
    expect(new Set(sequences).size).toBe(24);
    expect([...sequences].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    );
    // 严格递增（listEvents 按 sequence 升序返回）
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  it("分页读取按 after 游标推进（UI 按 sequence 去重）", async () => {
    const { runId } = await newRun();
    for (let i = 0; i < 5; i += 1) {
      await appendEvent({ runId, attemptId: "att-1", type: "text.delta", payload: { i }, eventId: nextId("evt") });
    }
    const firstPage = await listEvents({ runId, limit: 2 });
    expect(firstPage).toHaveLength(2);
    const secondPage = await listEvents({ runId, afterSequence: firstPage[1].sequence, limit: 10 });
    expect(secondPage).toHaveLength(3);
    expect(secondPage[0].sequence).toBeGreaterThan(firstPage[1].sequence);
  });

  it("attempt 结束事件可被查出（EOF 判定依据）", async () => {
    const { runId } = await newRun();
    expect(await readAttemptEndType(runId, "att-1")).toBeNull();
    await appendEvent({ runId, attemptId: "att-1", type: "run.completed", payload: {}, eventId: nextId("evt") });
    expect(await readAttemptEndType(runId, "att-1")).toBe("run.completed");
  });
});

describe("Run 状态：终态只出现一次", () => {
  it("第二次写入终态不生效（不覆盖首个结论）", async () => {
    const { runId } = await newRun();
    const first = await finishRun({ runId, status: "completed" });
    const second = await finishRun({ runId, status: "failed", lastError: "晚到的失败" });

    expect(first.status).toBe("updated");
    expect(second.status).toBe("already_terminal");

    const run = await getRun(runId);
    expect(run?.status).toBe("completed");
    // 晚到的失败不得覆盖已经成立的完成结论。
    expect(run?.lastError).toBeNull();
  });

  it("waiting_user 不是终态：之后仍可继续并被再次更新", async () => {
    const { runId } = await newRun();
    await finishRun({ runId, status: "waiting_user" });
    const run = await getRun(runId);
    expect(run?.status).toBe("waiting_user");
    expect(run?.finishedAt).toBeNull();

    const second = await finishRun({ runId, status: "completed" });
    expect(second.status).toBe("updated");
  });

  it("interrupted 之后仍可继续（它不是任务终态）", async () => {
    const { runId } = await newRun();
    await finishRun({ runId, status: "interrupted" });
    const second = await finishRun({ runId, status: "completed" });
    expect(second.status).toBe("updated");
  });
});

describe("取消与提交的先后顺序", () => {
  it("取消后 isRunWritable 为 false（晚到的提交会被拦下）", async () => {
    const { runId, userId } = await newRun();
    const lease = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    if (lease.status !== "acquired") throw new Error("expected acquired");

    expect(await isRunWritable(runId, lease.fenceToken)).toBe(true);
    await requestCancel(runId);
    expect(await isRunWritable(runId, lease.fenceToken)).toBe(false);
  });

  it("取消被接管后旧 fenceToken 失效（旧持有者不能继续写）", async () => {
    const { runId, userId } = await newRun();
    const first = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: -1 });
    if (first.status !== "acquired") throw new Error("expected acquired");
    const second = await acquireLease({ runId, userId, leaseOwner: "w2", ttlMs: 30_000 });
    if (second.status !== "acquired") throw new Error("expected acquired");

    // 旧 token 已作废。
    expect(await isRunWritable(runId, first.fenceToken)).toBe(false);
    expect(await isRunWritable(runId, second.fenceToken)).toBe(true);
  });

  it("提交成功后再取消：已完成的修改不被回滚（Run 保留结果）", async () => {
    const { runId, userId } = await newRun();
    const lease = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    if (lease.status !== "acquired") throw new Error("expected acquired");

    // 提交先发生
    await appendEvent({ runId, attemptId: "att-1", type: "mutation.committed", payload: { mutationId: "m1" }, eventId: nextId("evt") });
    // 然后取消
    await requestCancel(runId);

    const events = await listEvents({ runId });
    expect(events.some((e) => e.type === "mutation.committed")).toBe(true);
  });

  it("取消是幂等的，且不覆盖首次取消时间", async () => {
    const { runId } = await newRun();
    const first = await requestCancel(runId);
    expect(first).not.toBeNull();
    const runA = await getRun(runId);
    await requestCancel(runId);
    const runB = await getRun(runId);
    expect(runB?.cancelRequestedAt?.getTime()).toBe(runA?.cancelRequestedAt?.getTime());
  });

  it("对终态 Run 取消不生效", async () => {
    const { runId } = await newRun();
    await finishRun({ runId, status: "completed" });
    expect(await requestCancel(runId)).toBeNull();
  });
});

describe("工具账本：重试不重复记账", () => {
  it("同 (attempt, toolCallId) 第二次开始返回 false（说明是重试）", async () => {
    const { runId } = await newRun();
    const inputHash = toolInputHash("readResume", { section: "basics" });
    const first = await startToolExecution({
      id: nextId("t"), runId, attemptId: "att-1", toolCallId: "call-1",
      toolName: "readResume", inputHash,
    });
    const second = await startToolExecution({
      id: nextId("t"), runId, attemptId: "att-1", toolCallId: "call-1",
      toolName: "readResume", inputHash,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("完成的工具结果可读取（恢复时避免重放已成功的写操作）", async () => {
    const { runId } = await newRun();
    await startToolExecution({
      id: nextId("t"), runId, attemptId: "att-1", toolCallId: "call-w",
      toolName: "addWorkExperience", inputHash: "h",
    });
    await finishToolExecution({
      runId, attemptId: "att-1", toolCallId: "call-w",
      status: "succeeded", result: { applied: true }, mutationId: "mut-1",
    });
    const ledger = await listToolExecutions(runId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe("succeeded");
    expect(ledger[0].mutationId).toBe("mut-1");
  });

  it("不同 attempt 的同一 toolCallId 视为不同的账目", async () => {
    const { runId } = await newRun();
    const a = await startToolExecution({
      id: nextId("t"), runId, attemptId: "att-1", toolCallId: "call-1", toolName: "readResume", inputHash: "h",
    });
    const b = await startToolExecution({
      id: nextId("t"), runId, attemptId: "att-2", toolCallId: "call-1", toolName: "readResume", inputHash: "h",
    });
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});

describe("文档提交事件的投影（outbox）", () => {
  it("把该 Run 的提交事件补投影为 ai_run_event，并按 sourceEventId 去重", async () => {
    const { runId, resumeId, userId } = await newRun();
    // 直接插入一条 outbox 事件（模拟文档提交已原子落盘）。
    await testDb.client.unsafe(
      `INSERT INTO "resume_mutation_event" ("eventId","mutationId","resumeId","runId","type","payload")
       VALUES ($1,$2,$3,$4,'mutation.committed','{"revision":1}'::jsonb)`,
      [nextId("outbox"), nextId("mut"), resumeId, runId],
    );
    await testDb.client.unsafe(
      `INSERT INTO "resume_mutation_event" ("eventId","mutationId","resumeId","runId","type","payload")
       VALUES ($1,$2,$3,$4,'mutation.committed','{"revision":2}'::jsonb)`,
      [nextId("outbox"), nextId("mut"), resumeId, runId],
    );

    const projected = await reconcileMutationEvents(runId, "att-1", () => nextId("evt"));
    expect(projected).toBe(2);

    // 再次协调不重复投影。
    const again = await reconcileMutationEvents(runId, "att-1", () => nextId("evt"));
    expect(again).toBe(0);

    const events = await listEvents({ runId });
    const committed = events.filter((e) => e.type === "mutation.committed");
    expect(committed).toHaveLength(2);

    // 用户的 Run 记录仍然正常（不因投影而改变状态）。
    const run = await getRun(runId);
    expect(run?.status).toBe("running");
    void userId;
  });
});

describe("【复核发现】投影去重不得消耗序号", () => {
  it("重复投影同一源事件不产生序号缺口", async () => {
    /*
     * 真实缺陷：此前是「先取号、再 ON CONFLICT DO NOTHING」，去重命中时号已消耗，
     * 于是 eventSequence 会跳号（实测：库里 sequence=1 而计数器=2）。
     * 修法：取号与存在性检查连接 —— 已投影时不消耗序号。
     */
    const { runId, resumeId } = await newRun();
    await testDb.client.unsafe(
      `INSERT INTO "resume_mutation_event" ("eventId","mutationId","resumeId","runId","type","payload")
       VALUES ($1,$2,$3,$4,'mutation.committed','{"revision":1}'::jsonb)`,
      [nextId("outbox"), nextId("mut"), resumeId, runId],
    );

    const first = await reconcileMutationEvents(runId, "att-1", () => nextId("evt"));
    expect(first).toBe(1);

    // 重复协调：不应新增事件，也不应消耗序号。
    const second = await reconcileMutationEvents(runId, "att-1", () => nextId("evt"));
    expect(second).toBe(0);

    const counter = await testDb.client.unsafe<{ eventSequence: number }[]>(
      `SELECT "eventSequence" FROM "ai_run" WHERE id = $1`,
      [runId],
    );
    const events = await listEvents({ runId, limit: 100 });
    const maxSequence = Math.max(...events.map((e) => e.sequence));
    // 计数器与实际最大序号一致（无跳号）。
    expect(counter[0].eventSequence).toBe(maxSequence);
  });
});

describe("Run fencing 接入提交路径（复核发现 P0 的回归）", () => {
  /** 直接在隔离库上执行提交语句，验证 fence 条件真的生效。 */
  async function commitWithFence(input: {
    resumeId: string;
    userId: string;
    expectedRevision: number;
    fenceRunId: string | null;
    fenceToken: number | null;
    revision: number;
  }) {
    const { buildCommitStatement } = await import("@/lib/resume-mutations/store");
    const statement = buildCommitStatement({
      resumeId: input.resumeId,
      userId: input.userId,
      expectedRevision: input.expectedRevision,
      nextContentJson: JSON.stringify({ marker: "企图提交" }),
      nextRevision: input.revision,
      nextTitle: null,
      nextTemplateId: null,
      mutationId: `m-${Math.random().toString(36).slice(2)}`,
      mutationRowId: `row-${Math.random().toString(36).slice(2)}`,
      requestHash: "h",
      operationIdsJson: JSON.stringify(["op-1"]),
      operationCount: 1,
      beforeJson: JSON.stringify([{}]),
      afterJson: JSON.stringify([{}]),
      source: "agent",
      actorName: "张三",
      summary: null,
      undoOf: null,
      changeSetId: null,
      changeSetVersion: null,
      decisionId: null,
      versionId: `v-${Math.random().toString(36).slice(2)}`,
      eventId: `e-${Math.random().toString(36).slice(2)}`,
      runId: input.fenceRunId,
      fenceRunId: input.fenceRunId,
      fenceToken: input.fenceToken,
    });
    return testDb.db.execute(statement as never);
  }

  it("取消后，带 fence 的提交被数据库拦下（0 行、正文不变、无回执）", async () => {
    const { userId, resumeId, runId } = await newRun();
    const lease = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    if (lease.status !== "acquired") throw new Error("expected acquired");

    // 未取消时可提交。
    const before = await readResumeState(testDb, resumeId);
    const ok = await commitWithFence({
      resumeId,
      userId,
      expectedRevision: before.revision,
      fenceRunId: runId,
      fenceToken: lease.fenceToken,
      revision: before.revision + 1,
    });
    expect(Array.isArray(ok) ? ok.length : 0).toBe(1);

    // 取消之后再提交：必须被拦下。
    await requestCancel(runId);
    const afterCancel = await readResumeState(testDb, resumeId);
    const blocked = await commitWithFence({
      resumeId,
      userId,
      expectedRevision: afterCancel.revision,
      fenceRunId: runId,
      fenceToken: lease.fenceToken,
      revision: afterCancel.revision + 1,
    });
    expect(Array.isArray(blocked) ? blocked.length : 0).toBe(0);

    // 正文与 revision 都没有被这次企图提交改动。
    const final = await readResumeState(testDb, resumeId);
    expect(final.revision).toBe(afterCancel.revision);
  });

  it("被接管的旧 fenceToken 提交被拦下（平台硬杀后旧持有者晚到）", async () => {
    const { userId, resumeId, runId } = await newRun();
    const stale = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: -1 });
    if (stale.status !== "acquired") throw new Error("expected acquired");
    const fresh = await acquireLease({ runId, userId, leaseOwner: "w2", ttlMs: 30_000 });
    if (fresh.status !== "acquired") throw new Error("expected acquired");

    const state = await readResumeState(testDb, resumeId);
    const blocked = await commitWithFence({
      resumeId,
      userId,
      expectedRevision: state.revision,
      fenceRunId: runId,
      fenceToken: stale.fenceToken,
      revision: state.revision + 1,
    });
    expect(Array.isArray(blocked) ? blocked.length : 0).toBe(0);

    // 新 token 可以提交。
    const ok = await commitWithFence({
      resumeId,
      userId,
      expectedRevision: state.revision,
      fenceRunId: runId,
      fenceToken: fresh.fenceToken,
      revision: state.revision + 1,
    });
    expect(Array.isArray(ok) ? ok.length : 0).toBe(1);
  });

  it("Run 处于终态时提交被拦下（不可复活写）", async () => {
    const { userId, resumeId, runId } = await newRun();
    const lease = await acquireLease({ runId, userId, leaseOwner: "w1", ttlMs: 30_000 });
    if (lease.status !== "acquired") throw new Error("expected acquired");
    await finishRun({ runId, status: "completed" });

    const state = await readResumeState(testDb, resumeId);
    const blocked = await commitWithFence({
      resumeId,
      userId,
      expectedRevision: state.revision,
      fenceRunId: runId,
      fenceToken: lease.fenceToken,
      revision: state.revision + 1,
    });
    expect(Array.isArray(blocked) ? blocked.length : 0).toBe(0);
  });

  it("非 Run 的提交（无 fence）不受影响：编辑器手动编辑仍可保存", async () => {
    const { userId, resumeId } = await newRun();
    const state = await readResumeState(testDb, resumeId);
    const ok = await commitWithFence({
      resumeId,
      userId,
      expectedRevision: state.revision,
      fenceRunId: null,
      fenceToken: null,
      revision: state.revision + 1,
    });
    expect(Array.isArray(ok) ? ok.length : 0).toBe(1);
  });
});
