import { describe, expect, it } from "vitest";

import {
  isLeaseActive,
  resolveEofOutcome,
  assertSingleAttemptEnd,
  runRequestHash,
  buildRunEvent,
  RUN_EVENT_TYPES,
  isAttemptEndEvent,
} from "@/lib/ai/events";
import {
  buildAcquireLeaseStatement,
  buildFinishRunStatement,
  buildInsertRunStatement,
} from "@/lib/ai/run-store-sql";


function renderSql(statement: unknown): string {
  let counter = 0;
  function walk(node: unknown): string {
    const c = node as { value?: unknown; queryChunks?: unknown[] };
    if (c && Array.isArray(c.queryChunks)) {
      return c.queryChunks.map(walk).join("");
    }
    if (c && Array.isArray(c.value)) return (c.value as string[]).join("");
    if (typeof c?.value === "string") return c.value;
    counter += 1;
    return `$${counter}`;
  }
  return walk(statement);
}
describe("Run 事件契约", () => {
  it("事件类型是封闭集合，覆盖规格列出的全部类型", () => {
    const required = [
      "run.started",
      "attempt.started",
      "text.delta",
      "tool.started",
      "tool.arguments",
      "tool.succeeded",
      "tool.failed",
      "proposal.ready",
      "decision.recorded",
      "mutation.committed",
      "mutation.conflict",
      "run.waiting_user",
      "run.interrupted",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ];
    for (const type of required) {
      expect(RUN_EVENT_TYPES, `缺少事件类型 ${type}`).toContain(type);
    }
    expect(RUN_EVENT_TYPES).toHaveLength(required.length);
  });

  it("attempt 结束事件被正确识别（waiting_user/interrupted 也是结束）", () => {
    for (const type of ["run.waiting_user", "run.interrupted", "run.completed", "run.failed", "run.cancelled"]) {
      expect(isAttemptEndEvent(type as never), `${type} 应视为 attempt 结束`).toBe(true);
    }
    for (const type of ["text.delta", "tool.started", "run.started"]) {
      expect(isAttemptEndEvent(type as never), `${type} 不应视为 attempt 结束`).toBe(false);
    }
  });

  it("envelope 携带 schemaVersion=1 与数据库分配的 sequence", () => {
    const event = buildRunEvent({
      eventId: "e1",
      runId: "r1",
      attemptId: "a1",
      sequence: 7,
      type: "text.delta",
      payload: { text: "你" },
      occurredAt: new Date("2026-09-26T10:00:00.000Z"),
    });
    expect(event).toEqual({
      schemaVersion: 1,
      eventId: "e1",
      runId: "r1",
      attemptId: "a1",
      sequence: 7,
      type: "text.delta",
      occurredAt: "2026-09-26T10:00:00.000Z",
      payload: { text: "你" },
    });
  });
});

describe("EOF 判定：不假称完成", () => {
  it("没有结束事件时按中断处理", () => {
    const outcome = resolveEofOutcome("running", false);
    expect(outcome.status).toBe("interrupted");
    expect(outcome.reason).toContain("未收到结束事件");
  });

  it("已经给出结束事件时不变更状态", () => {
    expect(resolveEofOutcome("running", true).status).toBe("unchanged");
    expect(resolveEofOutcome("waiting_user", true).status).toBe("unchanged");
  });

  it("终态 Run 不因 EOF 被改写", () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(resolveEofOutcome(status, false).status).toBe("unchanged");
    }
  });
});

describe("attempt 只能有一个结束结果", () => {
  it("首次结束允许写入", () => {
    expect(() => assertSingleAttemptEnd(null, "run.completed")).not.toThrow();
  });

  it("第二次结束抛错（不覆盖已有终态）", () => {
    expect(() => assertSingleAttemptEnd("run.completed", "run.failed")).toThrow(/只能有一个结束结果/);
  });
});

describe("lease 与 fencing", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");

  it("有效租约属于当前持有者时通过", () => {
    expect(
      isLeaseActive(
        {
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(now.getTime() + 30_000),
          status: "running",
        },
        "worker-1",
        now,
      ),
    ).toBe(true);
  });

  it("租约过期 → 失效（平台硬杀后旧持有者不能继续写）", () => {
    expect(
      isLeaseActive(
        {
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(now.getTime() - 1_000),
          status: "running",
        },
        "worker-1",
        now,
      ),
    ).toBe(false);
  });

  it("不是当前持有者 → 失效（接管后旧持有者被挡）", () => {
    expect(
      isLeaseActive(
        {
          leaseOwner: "worker-2",
          leaseExpiresAt: new Date(now.getTime() + 30_000),
          status: "running",
        },
        "worker-1",
        now,
      ),
    ).toBe(false);
  });

  it("已请求取消 → 即使租约未过期也失效", () => {
    expect(
      isLeaseActive(
        {
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(now.getTime() + 30_000),
          status: "running",
          cancelRequestedAt: new Date(now.getTime() - 100),
        },
        "worker-1",
        now,
      ),
    ).toBe(false);
  });

  it("终态 Run 的租约一律失效", () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(
        isLeaseActive(
          { leaseOwner: "worker-1", leaseExpiresAt: new Date(now.getTime() + 30_000), status },
          "worker-1",
          now,
        ),
      ).toBe(false);
    }
  });

  it("获取租约的 SQL 带条件（并发下只有一个能改到行）且递增 fenceToken", () => {
    const sqlText = renderSql(
      buildAcquireLeaseStatement({
        runId: "r1",
        userId: "u1",
        leaseOwner: "w1",
        leaseExpiresAt: now,
      }),
    );
    expect(sqlText).toMatch(/status NOT IN \('completed', 'failed', 'cancelled'\)/);
    expect(sqlText).toMatch(/"leaseOwner" IS NULL OR "leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now\(\)/);
    expect(sqlText).toMatch(/"fenceToken" = "fenceToken" \+ 1/);
  });
});

describe("Run 状态转换由数据库保证", () => {
  it("终态写入带 status NOT IN 条件（终态只出现一次）", () => {
    const sqlText = renderSql(buildFinishRunStatement({ runId: "r1", status: "completed" }));
    expect(sqlText).toMatch(/status NOT IN \('completed', 'failed', 'cancelled'\)/);
  });

  it("waiting_user 不设置 finishedAt（它不是任务终态）", () => {
    const waiting = renderSql(buildFinishRunStatement({ runId: "r1", status: "waiting_user" }));
    const terminal = renderSql(buildFinishRunStatement({ runId: "r1", status: "failed" }));
    expect(waiting).toContain('"finishedAt" = "finishedAt"');
    expect(terminal).toMatch(/"finishedAt" = now\(\)/);
  });

  it("start 幂等：按 (userId, requestId) 冲突时不新建 Run", () => {
    const sqlText = renderSql(
      buildInsertRunStatement({
        id: "run-1",
        userId: "u1",
        resumeId: "r1",
        sessionId: null,
        requestId: "req-1",
        mode: "optimize_existing",
        writeMode: "direct",
        promptVersion: null,
        modelId: null,
        deadlineAt: null,
      }),
    );
    expect(sqlText).toMatch(/ON CONFLICT \("userId", "requestId"\) DO NOTHING/);
  });
});

describe("请求哈希：幂等键稳定", () => {
  const base = {
    resumeId: "r1",
    sessionId: "s1",
    message: "帮我改一下",
    mode: "optimize_existing",
    writeMode: "direct",
  };

  it("同一逻辑请求得到相同哈希（重试可复用 Run）", () => {
    expect(runRequestHash(base)).toBe(runRequestHash({ ...base }));
  });

  it("消息不同 → 哈希不同（新的编辑是新请求）", () => {
    expect(runRequestHash(base)).not.toBe(runRequestHash({ ...base, message: "换一个说法" }));
  });

  it("writeMode 变化会改变哈希（授权范围不同不得混用）", () => {
    expect(runRequestHash(base)).not.toBe(runRequestHash({ ...base, writeMode: "approval" }));
  });
});
