import { describe, expect, it } from "vitest";
import { hashTargetValue, type SemanticOperation } from "@intro-builder/shared/schemas";

import {
  describeDecisionOutcome,
  validateDecision,
  type PersistedProposal,
} from "@/lib/ai/change-set";

/**
 * 决策校验与状态语义（P04 任务 4）。
 *
 * 这些规则的价值在于：批准是**用户意图**，提交才是**实际应用**。
 * 把两者混在一起会产生两类难以察觉的错误 —— 批准了旧版本的内容，
 * 或批准后提交冲突却显示「已应用」。
 */

function setField(id: string, itemId: string, value: string): SemanticOperation {
  return {
    id,
    kind: "set_field",
    target: { section: "experience", itemId, field: "company" },
    condition: { expectedValueHash: hashTargetValue("旧值") },
    value,
  };
}

function insert(id: string, itemId: string): SemanticOperation {
  return {
    id,
    kind: "insert_item",
    section: "experience",
    itemId,
    afterItemId: null,
    expectedOrderHash: hashTargetValue([]),
    value: { company: "新公司" },
  };
}

function proposal(operations: SemanticOperation[], overrides: Partial<PersistedProposal> = {}): PersistedProposal {
  return {
    id: "cs-1",
    resumeId: "r-1",
    userId: "u-1",
    runId: "run-1",
    title: "完善经历",
    baseRevision: 3,
    proposalVersion: 1,
    operations,
    status: "pending",
    summary: null,
    ...overrides,
  };
}

describe("决策校验：版本绑定", () => {
  it("版本一致时通过", () => {
    const result = validateDecision(proposal([setField("op-1", "exp-a", "新")]), {
      changeSetId: "cs-1",
      proposalVersion: 1,
      acceptedOperationIds: ["op-1"],
      rejectedOperationIds: [],
    });
    expect(result.ok).toBe(true);
  });

  it("客户端基于旧版本决策时拒绝（提案已重新生成）", () => {
    /*
     * 真实场景：用户看到 v1 的提案 → AI 又改了内容生成 v2 → 用户点了 v1 的批准。
     * 那个批准落在**已经不存在**的内容上，必须拒绝而不是照做。
     */
    const result = validateDecision(proposal([setField("op-1", "exp-a", "新")], { proposalVersion: 2 }), {
      changeSetId: "cs-1",
      proposalVersion: 1,
      acceptedOperationIds: ["op-1"],
      rejectedOperationIds: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("stale_proposal_version");
    // 提示必须告诉用户当前版本，否则无从纠正。
    expect(result.message).toContain("第 2 版");
  });

  it("已提交或已拒绝的提案不能再决策", () => {
    for (const status of ["committed", "rejected"] as const) {
      const result = validateDecision(proposal([setField("op-1", "exp-a", "新")], { status }), {
        changeSetId: "cs-1",
        proposalVersion: 1,
        acceptedOperationIds: ["op-1"],
        rejectedOperationIds: [],
      });
      expect(result.ok, status).toBe(false);
    }
  });
});

describe("决策校验：操作集合", () => {
  it("同一操作既接受又拒绝时拒绝", () => {
    const result = validateDecision(proposal([setField("op-1", "exp-a", "新")]), {
      changeSetId: "cs-1",
      proposalVersion: 1,
      acceptedOperationIds: ["op-1"],
      rejectedOperationIds: ["op-1"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("operation_both_accepted_and_rejected");
  });

  it("引用不属于该提案的操作时拒绝", () => {
    const result = validateDecision(proposal([setField("op-1", "exp-a", "新")]), {
      changeSetId: "cs-1",
      proposalVersion: 1,
      acceptedOperationIds: ["op-other"],
      rejectedOperationIds: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unknown_operation");
  });

  it("只返回被接受的操作（拒绝的不得进入提交）", () => {
    const ops = [setField("op-1", "exp-a", "甲"), setField("op-2", "exp-b", "乙")];
    const result = validateDecision(proposal(ops), {
      changeSetId: "cs-1",
      proposalVersion: 1,
      acceptedOperationIds: ["op-1"],
      rejectedOperationIds: ["op-2"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted.map((op) => op.id)).toEqual(["op-1"]);
    // 拒绝的操作**不会**出现在可提交集合里 —— 这保证「拒绝后不再执行」。
    expect(result.accepted.some((op) => op.id === "op-2")).toBe(false);
  });
});

describe("决策校验：依赖关系", () => {
  it("接受新增条目、同时接受对它的更新 → 通过", () => {
    const result = validateDecision(
      proposal([insert("op-insert", "exp-new"), setField("op-update", "exp-new", "丙")]),
      {
        changeSetId: "cs-1",
        proposalVersion: 1,
        acceptedOperationIds: ["op-insert", "op-update"],
        rejectedOperationIds: [],
      },
    );
    expect(result.ok).toBe(true);
  });

  it("接受新增条目但拒绝对它的更新 → 通过（用户只想要条目）", () => {
    const result = validateDecision(
      proposal([insert("op-insert", "exp-new"), setField("op-update", "exp-new", "丙")]),
      {
        changeSetId: "cs-1",
        proposalVersion: 1,
        acceptedOperationIds: ["op-insert"],
        rejectedOperationIds: ["op-update"],
      },
    );
    expect(result.ok).toBe(true);
  });

  it("**拒绝新增却接受对它的更新** → 拒绝（会产出指向不存在目标的命令）", () => {
    const result = validateDecision(
      proposal([insert("op-insert", "exp-new"), setField("op-update", "exp-new", "丙")]),
      {
        changeSetId: "cs-1",
        proposalVersion: 1,
        acceptedOperationIds: ["op-update"],
        rejectedOperationIds: ["op-insert"],
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("dependency_rejected");
  });

  it("全部拒绝是合法决策（不产生提交）", () => {
    const result = validateDecision(proposal([setField("op-1", "exp-a", "新")]), {
      changeSetId: "cs-1",
      proposalVersion: 1,
      acceptedOperationIds: [],
      rejectedOperationIds: ["op-1"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toHaveLength(0);
  });
});

describe("决策状态语义：批准 ≠ 已保存", () => {
  it("提交成功且全部落盘 → committed", () => {
    const outcome = describeDecisionOutcome({
      acceptedCount: 2,
      rejectedCount: 0,
      committedCount: 2,
      lastCommitStatus: "committed",
      revision: 5,
    });
    expect(outcome.status).toBe("committed");
  });

  it("只提交了部分 → partially_committed（不笼统报「已批准」）", () => {
    const outcome = describeDecisionOutcome({
      acceptedCount: 3,
      rejectedCount: 0,
      committedCount: 1,
      lastCommitStatus: "committed",
    });
    expect(outcome.status).toBe("partially_committed");
  });

  it("**批准后提交冲突 → awaiting_commit（已确认，尚未保存）**", () => {
    /*
     * 这是契约明确要求的区分：决策记录表达「用户选择」，回执表达「实际应用」。
     * 冲突时不能写成「已批准并应用」，否则用户以为内容已经改了。
     */
    const outcome = describeDecisionOutcome({
      acceptedCount: 2,
      rejectedCount: 0,
      committedCount: 0,
      lastCommitStatus: "conflict",
    });
    expect(outcome.status).toBe("awaiting_commit");
    if (outcome.status !== "awaiting_commit") return;
    expect(outcome.reason).toContain("尚未保存");
  });

  it("全部拒绝 → rejected（终态，无需提交）", () => {
    const outcome = describeDecisionOutcome({
      acceptedCount: 0,
      rejectedCount: 3,
      committedCount: 0,
      lastCommitStatus: null,
    });
    expect(outcome.status).toBe("rejected");
  });

  it("无变化也视为已满足（服务端确认无需改动）", () => {
    const outcome = describeDecisionOutcome({
      acceptedCount: 1,
      rejectedCount: 0,
      committedCount: 0,
      lastCommitStatus: "no_change",
      revision: 7,
    });
    expect(outcome.status).toBe("committed");
  });
});
