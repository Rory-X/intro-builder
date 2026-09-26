import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * change-set 决策路由的行为契约（P04 任务 4）。
 *
 * 重点是三类「看起来成功但其实没落盘」的失败：
 *
 * 1. **陈旧版本被静默接受**：AI 又改了提案，用户拿旧版本点「应用」——
 *    必须拒绝，而不是把批准挂在已经不存在的内容上。
 * 2. **批准被当成已保存**：批准只写决策记录；若提交发生 revision 冲突，
 *    响应必须是「已确认、尚未保存」，绝不能报 `applied: true`。
 * 3. **越权**：别人的 changeSet 不能决策，且不能泄露它的存在（404，不是 403）。
 */

const authMock = vi.fn();
const getProposalMock = vi.fn();
const validateDecisionMock = vi.fn();
const recordDecisionMock = vi.fn();
const setProposalStatusMock = vi.fn();
const describeDecisionOutcomeMock = vi.fn();
const commitMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/ai/change-set", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/change-set")>("@/lib/ai/change-set");
  return {
    ...actual,
    getProposal: (...args: unknown[]) => getProposalMock(...args),
    validateDecision: (...args: unknown[]) => validateDecisionMock(...args),
    recordDecision: (...args: unknown[]) => recordDecisionMock(...args),
    setProposalStatus: (...args: unknown[]) => setProposalStatusMock(...args),
    describeDecisionOutcome: (...args: unknown[]) => describeDecisionOutcomeMock(...args),
  };
});
vi.mock("@/lib/resume-mutations/commit", () => ({
  commitResumeMutation: (...args: unknown[]) => commitMock(...args),
}));

type Proposal = {
  id: string;
  resumeId: string;
  userId: string;
  runId: string | null;
  title: string;
  baseRevision: number;
  proposalVersion: number;
  operations: Array<{ id: string; kind: string; target?: unknown }>;
  status: string;
  summary: string | null;
};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "cs-1",
    resumeId: "resume-1",
    userId: "user-1",
    runId: "run-1",
    title: "优化项目描述",
    baseRevision: 7,
    proposalVersion: 2,
    operations: [
      { id: "op-1", kind: "set_field", target: { section: "experience", itemId: "exp-a", field: "content" } },
    ],
    status: "pending",
    summary: "更具体地描述贡献",
    ...overrides,
  };
}

async function callRoute(body: unknown) {
  const { POST } = await import("@/app/api/ai/change-sets/[changeSetId]/decisions/route");
  return POST(
    new Request("http://localhost/api/ai/change-sets/cs-1/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ changeSetId: "cs-1" }) },
  );
}

describe("change-set 决策路由", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    getProposalMock.mockReset();
    validateDecisionMock.mockReset();
    recordDecisionMock.mockReset().mockResolvedValue({ recorded: true });
    setProposalStatusMock.mockReset().mockResolvedValue(undefined);
    describeDecisionOutcomeMock.mockReset();
    commitMock.mockReset();
  });

  it("未登录返回 401，且不读取提案", async () => {
    authMock.mockResolvedValue(null);
    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(401);
    expect(getProposalMock).not.toHaveBeenCalled();
  });

  it("别人的提案返回 404（不泄露存在性），且不暴露身份", async () => {
    getProposalMock.mockResolvedValue(proposal({ userId: "someone-else" }));
    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(404);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("提案不存在返回 404", async () => {
    getProposalMock.mockResolvedValue(null);
    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(404);
  });

  it("请求体缺 proposalVersion 返回 400，不入库也不提交", async () => {
    getProposalMock.mockResolvedValue(proposal());
    const response = await callRoute({ acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(400);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("proposalVersion 不是整数返回 400", async () => {
    getProposalMock.mockResolvedValue(proposal());
    for (const bad of [1.5, "2", null, NaN]) {
      const response = await callRoute({ proposalVersion: bad, acceptedOperationIds: ["op-1"] });
      expect(response.status).toBe(400);
    }
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("陈旧版本：校验不通过时返回 409，且**不**写决策、**不**提交", async () => {
    getProposalMock.mockResolvedValue(proposal());
    validateDecisionMock.mockReturnValue({
      ok: false,
      code: "stale_proposal_version",
      message: "提案已更新到第 3 版",
    });

    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(409);
    const json = (await response.json()) as { code?: string; applied?: boolean };
    expect(json.code).toBe("stale_proposal_version");
    // 关键：没批准就不该有任何落盘副作用。
    expect(recordDecisionMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("全部拒绝：记录决策、标记提案为 rejected，且不提交文档", async () => {
    getProposalMock.mockResolvedValue(proposal());
    validateDecisionMock.mockReturnValue({ ok: true, accepted: [], rejectedIds: ["op-1"] });
    describeDecisionOutcomeMock.mockReturnValue({ status: "rejected", acceptedCount: 0, rejectedCount: 1 });

    const response = await callRoute({ proposalVersion: 2, rejectedOperationIds: ["op-1"] });
    expect(response.status).toBe(200);
    expect(commitMock).not.toHaveBeenCalled();
    expect(setProposalStatusMock).toHaveBeenCalledWith("cs-1", "rejected");

    const json = (await response.json()) as { status: string; applied: boolean };
    expect(json.status).toBe("rejected");
    // 拒绝不是「已应用」。
    expect(json.applied).toBe(false);
  });

  it("有提交回执时如实报告 applied=true 与 revision", async () => {
    getProposalMock.mockResolvedValue(proposal());
    validateDecisionMock.mockReturnValue({
      ok: true,
      accepted: [{ id: "op-1", kind: "set_field" }],
      rejectedIds: [],
    });
    describeDecisionOutcomeMock.mockReturnValue({ status: "committed", acceptedCount: 1, revision: 9 });
    commitMock.mockResolvedValue({
      status: "committed",
      result: { status: "committed", mutationId: "m-1", revision: 9 },
    });

    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { status: string; applied: boolean; revision?: number };
    expect(json.applied).toBe(true);
    expect(json.revision).toBe(9);
    expect(setProposalStatusMock).toHaveBeenCalledWith("cs-1", "committed");
  });

  it("提交冲突：响应是「已确认、尚未保存」，绝不 applied=true", async () => {
    getProposalMock.mockResolvedValue(proposal());
    validateDecisionMock.mockReturnValue({
      ok: true,
      accepted: [{ id: "op-1", kind: "set_field" }],
      rejectedIds: [],
    });
    describeDecisionOutcomeMock.mockReturnValue({
      status: "awaiting_commit",
      acceptedCount: 1,
      reason: "文档已被更新，请基于最新内容重新确认",
    });
    commitMock.mockResolvedValue({
      status: "conflict",
      result: { status: "conflict", code: "revision_mismatch" },
    });

    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { status: string; applied: boolean };
    expect(json.applied).toBe(false);
    expect(json.status).toBe("awaiting_commit");
    // 冲突时提案**不能**被标为 committed。
    expect(setProposalStatusMock).not.toHaveBeenCalledWith("cs-1", "committed");
  });

  it("决策记录写失败时不谎报成功", async () => {
    getProposalMock.mockResolvedValue(proposal());
    validateDecisionMock.mockReturnValue({
      ok: true,
      accepted: [{ id: "op-1", kind: "set_field" }],
      rejectedIds: [],
    });
    recordDecisionMock.mockResolvedValue({ recorded: false });

    const response = await callRoute({ proposalVersion: 2, acceptedOperationIds: ["op-1"] });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(commitMock).not.toHaveBeenCalled();
  });
});
