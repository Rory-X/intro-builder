import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 平台硬杀后的 interrupted 识别（P04 任务 6）。
 *
 * 这是最容易漏掉的一条：硬杀时 `finally` 不执行、AbortSignal 不触发、
 * 内存标志随进程消失，于是 Run **永久停留在 running**，UI 一直显示「执行中」。
 *
 * 判据必须同时成立：**租约已过期**（唯一可靠信号）+ **没有任何 attempt
 * 给出过结束事件**。两个方向都要防：
 *
 * - 漏判 → Run 卡在 running，用户永远等一个不会来的事件；
 * - 误判 → 把**正在执行**的 Run 改成 interrupted，它随后的提交被 fence 拦下，
 *   用户看到「明明在跑却报失败」。
 */

const executeMock = vi.fn();

vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => executeMock(...a) } }));

/**
 * 极简 SQL 渲染器：把 drizzle 的 sql`` 片段渲染成文本，便于断言条件。
 *
 * 只需要能把参数值与字面量拼出来 —— 这个测试关心的是**条件包含什么**
 * （是否核验了租约过期、是否排除了终态），而不是 SQL 的具体格式。
 */
function renderSql(statement: unknown): string {
  const chunks = (statement as { queryChunks?: unknown[] })?.queryChunks ?? [];
  const parts: string[] = [];
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object" && "value" in chunk) {
      const value = (chunk as { value: unknown }).value;
      parts.push(Array.isArray(value) ? value.join("") : String(value));
    } else if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
      // 嵌套片段递归展开 —— 不展开会漏掉真实差异。
      parts.push(renderSql(chunk));
    } else {
      parts.push(String(chunk));
    }
  }
  return parts.join("?");
}

const { buildMarkInterruptedOnExpiredLeaseStatement, buildLatestAttemptEndStatement } = await import(
  "@/lib/ai/run-store-sql"
);

describe("标记中断的 SQL 条件", () => {
  it("只标记租约**已过期**的 Run（这是硬杀的唯一可靠信号）", () => {
    const sqlText = renderSql(
      buildMarkInterruptedOnExpiredLeaseStatement({ runId: "r1", status: "interrupted", lastError: null }),
    );
    expect(sqlText).toContain('"leaseExpiresAt" < now()');
    // 没有租约的行（从未开始执行的 Run）不该被标记。
    expect(sqlText).toContain('"leaseOwner" IS NOT NULL');
    expect(sqlText).toContain('"leaseExpiresAt" IS NOT NULL');
  });

  it("绝不覆盖终态（终态只出现一次）", () => {
    const sqlText = renderSql(
      buildMarkInterruptedOnExpiredLeaseStatement({ runId: "r1", status: "interrupted", lastError: null }),
    );
    expect(sqlText).toContain("'completed', 'failed', 'cancelled'");
  });

  it("用户主动取消的 Run 不被改写成 interrupted", () => {
    const sqlText = renderSql(
      buildMarkInterruptedOnExpiredLeaseStatement({ runId: "r1", status: "interrupted", lastError: null }),
    );
    expect(sqlText).toContain('"cancelRequestedAt" IS NULL');
  });

  it("标记时清空租约并写入 finishedAt（不留悬挂租约）", () => {
    const sqlText = renderSql(
      buildMarkInterruptedOnExpiredLeaseStatement({ runId: "r1", status: "interrupted", lastError: null }),
    );
    expect(sqlText).toContain('"leaseOwner" = NULL');
    expect(sqlText).toContain('"finishedAt" = now()');
  });

  it("取最近一条结束事件时**不限 attemptId**（要回答「有没有任何 attempt 结束过」）", () => {
    const sqlText = renderSql(buildLatestAttemptEndStatement("r1"));
    expect(sqlText).not.toContain("attemptId");
    expect(sqlText).toContain("ORDER BY");
  });
});

describe("markInterruptedIfLeaseExpired 的判定", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
  });

  type RunRow = {
    id: string;
    userId: string;
    resumeId: string;
    status: string;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    cancelRequestedAt: Date | null;
    fenceToken: number;
  };

  function runRow(overrides: Partial<RunRow> = {}): RunRow {
    return {
      id: "run-1",
      userId: "user-1",
      resumeId: "resume-1",
      status: "running",
      leaseOwner: "dead",
      leaseExpiresAt: new Date(Date.now() - 60_000),
      cancelRequestedAt: null,
      fenceToken: 2,
      ...overrides,
    };
  }

  async function call(run: RunRow, latestEndType: string | null) {
    const { markInterruptedIfLeaseExpired } = await import("@/lib/ai/run-store");
    // 第 1 次：getRun；第 2 次：查最近结束事件；第 3 次：条件 UPDATE。
    executeMock
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce(latestEndType ? [{ type: latestEndType }] : [])
      .mockResolvedValueOnce([{ id: "run-1", status: "interrupted" }]);
    return markInterruptedIfLeaseExpired("run-1");
  }

  it("running + 租约过期 + 无结束事件 → 标记 interrupted", async () => {
    expect(await call(runRow(), null)).toBe(true);
    // 第三条语句是 UPDATE。
    const updateSql = renderSql(executeMock.mock.calls[2][0]);
    expect(updateSql).toContain("UPDATE");
  });

  it("已有结束事件 → 不标记（不能覆盖已发生的事实）", async () => {
    expect(await call(runRow(), "run.waiting_user")).toBe(false);
    // 只读了两次（getRun + 查结束事件），**没有**发 UPDATE。
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("终态 Run → 不标记", async () => {
    expect(await call(runRow({ status: "completed" }), null)).toBe(false);
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("已取消的 Run → 不标记（取消语义优先）", async () => {
    // resolveEofOutcome 只看状态与结束事件；cancelled 属终态因此在这里被拦。
    expect(await call(runRow({ status: "cancelled" }), null)).toBe(false);
  });

  it("Run 不存在 → 不标记，也不查事件", async () => {
    const { markInterruptedIfLeaseExpired } = await import("@/lib/ai/run-store");
    executeMock.mockResolvedValueOnce([]);
    expect(await markInterruptedIfLeaseExpired("run-x")).toBe(false);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
