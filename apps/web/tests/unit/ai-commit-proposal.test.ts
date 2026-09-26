import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 工具提案落盘的行为契约（P04 任务 4 直接模式）。
 *
 * 这是「提案 → 真实提交 → 回执」的接线点，也是最容易造出**假成功**的地方。
 * 三条不可让步的约束，每一条对应一类真实缺陷：
 *
 * 1. **没有回执就不是已保存**。只有 `committed`（带 mutationId + revision）
 *    才把结果标成已落盘；冲突 / 拒绝必须如实回报。
 * 2. **fence 必须原样透传**。取消与提交可能并发，只有数据库在写语句内核验
 *    「仍可写」，才能让「取消先成功则禁止提交」成立。
 * 3. **幂等键在重试时必须相同**。由调用方（toolCallId 派生）传入，
 *    本模块绝不自己生成随机值 —— 否则重试会变成第二次修改。
 */

const commitMock = vi.fn();

vi.mock("@/lib/resume-mutations/commit", () => ({
  commitResumeMutation: (...args: unknown[]) => commitMock(...args),
}));

type Proposal = {
  status: "proposed";
  operations: Array<{ id: string; kind: string }>;
  summary: string;
};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    status: "proposed",
    operations: [{ id: "op-1", kind: "set_field" }],
    summary: "更具体地描述贡献",
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    proposal: proposal(),
    resumeId: "resume-1",
    userId: "user-1",
    actorName: "林可",
    expectedRevision: 7,
    fence: { runId: "run-1", fenceToken: 3 },
    runId: "run-1",
    mutationId: "agent-call-1",
    ...overrides,
  };
}

async function commit(args: ReturnType<typeof input>) {
  const { commitToolProposal } = await import("@/lib/ai/commit-proposal");
  return commitToolProposal(args as never);
}

describe("提案落盘", () => {
  beforeEach(() => {
    vi.resetModules();
    commitMock.mockReset();
  });

  it("committed 时返回真实回执（mutationId + revision）", async () => {
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    const outcome = await commit(input());
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") throw new Error("预期成功");
    // 回执是编排层发出 mutation.committed 的唯一依据。
    expect(outcome.mutationId).toBe("m-1");
    expect(outcome.revision).toBe(9);
  });

  it("conflict 时**不**报成功，并说明内容已变化", async () => {
    commitMock.mockResolvedValue({
      status: "conflict",
      result: { status: "conflict", currentRevision: 12, targets: [] },
    });

    const outcome = await commit(input());
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("预期失败");
    expect(outcome.code).toBe("revision_conflict");
    // 必须让模型/用户知道当前版本，便于重新确认。
    expect(outcome.message).toContain("12");
    // 关键：绝不能带 mutationId，否则编排层会误以为已落盘。
    expect(outcome).not.toHaveProperty("mutationId");
  });

  it("no_change 如实说明没有写入，不谎称已保存", async () => {
    commitMock.mockResolvedValue({
      status: "no_change",
      result: { status: "no_change", currentRevision: 7 },
    });

    const outcome = await commit(input());
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") throw new Error("预期成功");
    expect(outcome.mutationId).toBeUndefined();
    expect(outcome.result.saved).toBe(false);
  });

  it("rejected 时把 code 带出并给出可理解的说明", async () => {
    commitMock.mockResolvedValue({
      status: "rejected",
      result: { status: "rejected", code: "run_not_writable" },
    });

    const outcome = await commit(input());
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("预期失败");
    expect(outcome.code).toBe("run_not_writable");
    expect(outcome.message.length).toBeGreaterThan(0);
  });

  it("fence 原样透传给提交层（这是拦住晚到提交的唯一实现点）", async () => {
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    await commit(input({ fence: { runId: "run-9", fenceToken: 42 } }));
    const principal = commitMock.mock.calls[0][0] as { fence: unknown };
    expect(principal.fence).toEqual({ runId: "run-9", fenceToken: 42 });
  });

  it("幂等键使用调用方给的值，不由本模块随机生成", async () => {
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    await commit(input({ mutationId: "agent-call-xyz" }));
    const command = commitMock.mock.calls[0][1] as { mutationId: string };
    expect(command.mutationId).toBe("agent-call-xyz");

    // 同样的输入再跑一次，必须得到同一个键（重试 = 幂等重放）。
    await commit(input({ mutationId: "agent-call-xyz" }));
    expect((commitMock.mock.calls[1][1] as { mutationId: string }).mutationId).toBe("agent-call-xyz");
  });

  it("CAS 基准用调用方给的 expectedRevision", async () => {
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    await commit(input({ expectedRevision: 7 }));
    const command = commitMock.mock.calls[0][1] as { expectedRevision: number };
    expect(command.expectedRevision).toBe(7);
  });

  it("source 固定为 agent，不取自调用方输入", async () => {
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    await commit(input());
    const principal = commitMock.mock.calls[0][0] as { source: string };
    expect(principal.source).toBe("agent");
  });

  it("空提案不提交，也不报成功", async () => {
    const outcome = await commit(input({ proposal: proposal({ operations: [] }) }));
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("预期失败");
    expect(outcome.code).toBe("empty_proposal");
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("提交上下文里带上 resumeId 与 userId（归属不由请求体决定）", async () => {
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    await commit(input({ resumeId: "resume-42", userId: "user-9" }));
    const command = commitMock.mock.calls[0][1] as { resumeId: string };
    const principal = commitMock.mock.calls[0][0] as { userId: string };
    expect(command.resumeId).toBe("resume-42");
    expect(principal.userId).toBe("user-9");
  });
});
