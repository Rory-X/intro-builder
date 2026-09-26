import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getProposal,
  recordDecision,
  saveProposal,
  setProposalStatus,
  validateDecision,
} from "@/lib/ai/change-set";
import type { SemanticOperation } from "@intro-builder/shared/schemas";
import { hashTargetValue } from "@intro-builder/shared/schemas";
import { resetChangeSetExecutor, setChangeSetExecutorForTesting } from "@/lib/ai/change-set";
import { createTestDb, seedResume, type TestDb } from "./helpers/test-db";

/**
 * 提案与决策的真实数据库验证（P04 任务 4）。
 *
 * 重点验证两条契约要求：
 * 1. 版本**只在内容变化时**递增（否则重复生成会把已批准提案打回待确认）；
 * 2. 决策按 (changeSetId, proposalVersion) 唯一（重复点击批准不产生两条记录）。
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb("ai-change-set");
  setChangeSetExecutorForTesting((statement) => testDb.db.execute(statement));
});

afterAll(async () => {
  resetChangeSetExecutor();
  await testDb?.dispose();
});

function op(id: string, value: string): SemanticOperation {
  return {
    id,
    kind: "set_field",
    target: { section: "experience", itemId: "exp-a", field: "company" },
    condition: { expectedValueHash: hashTargetValue("旧") },
    value,
  };
}

async function scenario() {
  const { userId, resumeId } = await seedResume(testDb);
  return { userId, resumeId, changeSetId: `cs-${Math.random().toString(36).slice(2)}` };
}

describe("提案版本", () => {
  it("首次保存为 v1", async () => {
    const s = await scenario();
    const saved = await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "完善经历", baseRevision: 0, operations: [op("o1", "甲")], summary: null,
    });
    expect(saved.proposalVersion).toBe(1);
  });

  it("内容变化时递增版本", async () => {
    const s = await scenario();
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "甲")], summary: null,
    });
    const second = await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "乙")], summary: null,
    });
    expect(second.proposalVersion).toBe(2);
  });

  it("【复核发现】内容**完全相同**时不得递增版本、不得打回 pending", async () => {
    /*
     * 真实缺陷：此前无条件 `version + 1` + `status = 'pending'`，
     * 于是 AI 重新生成一份逐字节相同的提案就会把已 committed 的提案打回待确认，
     * 且旧版本的批准会被 stale_proposal_version 拒绝 —— 用户看到
     * 「刚批准的东西又变回待确认」。
     */
    const s = await scenario();
    const operations = [op("o1", "甲")];
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations, summary: null,
    });
    await setProposalStatus(s.changeSetId, "committed");

    const again = await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "甲")], summary: null,
    });
    expect(again.proposalVersion).toBe(1);

    const proposal = await getProposal(s.changeSetId);
    // 已提交的提案不得因重复生成而回退。
    expect(proposal?.status).toBe("committed");
  });

  it("内容变化后已批准状态随版本失效（回到 pending）", async () => {
    const s = await scenario();
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "甲")], summary: null,
    });
    await setProposalStatus(s.changeSetId, "committed");
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "乙")], summary: null,
    });
    const proposal = await getProposal(s.changeSetId);
    expect(proposal?.proposalVersion).toBe(2);
    expect(proposal?.status).toBe("pending");
  });
});

describe("决策", () => {
  it("同一版本只记录一条决策（重复批准不产生两条）", async () => {
    const s = await scenario();
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "甲")], summary: null,
    });

    const first = await recordDecision({
      id: `d-${Math.random()}`, changeSetId: s.changeSetId, proposalVersion: 1,
      acceptedOperationIds: ["o1"], rejectedOperationIds: [], userId: s.userId,
    });
    const second = await recordDecision({
      id: `d-${Math.random()}`, changeSetId: s.changeSetId, proposalVersion: 1,
      acceptedOperationIds: ["o1"], rejectedOperationIds: [], userId: s.userId,
    });
    expect(first.recorded).toBe(true);
    // 第二次写入被唯一键拦下（不新增记录）。
    expect(second.recorded).toBe(false);

    const rows = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_decision" WHERE "changeSetId" = $1`,
      [s.changeSetId],
    );
    expect(rows[0].n).toBe("1");
  });

  it("数据库读回的提案可被决策校验消费（端到端）", async () => {
    const s = await scenario();
    const operations = [op("o1", "甲"), op("o2", "乙")];
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations, summary: null,
    });

    const proposal = await getProposal(s.changeSetId);
    if (!proposal) throw new Error("expected proposal");
    expect(proposal.operations).toHaveLength(2);

    // 只接受其中一条。
    const decision = validateDecision(proposal, {
      changeSetId: s.changeSetId,
      proposalVersion: 1,
      acceptedOperationIds: ["o1"],
      rejectedOperationIds: ["o2"],
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.accepted.map((o) => o.id)).toEqual(["o1"]);
  });

  it("版本不匹配时拒绝（客户端基于旧版本决策）", async () => {
    const s = await scenario();
    await saveProposal({
      id: s.changeSetId, resumeId: s.resumeId, userId: s.userId, runId: null,
      title: "t", baseRevision: 0, operations: [op("o1", "甲")], summary: null,
    });
    const proposal = await getProposal(s.changeSetId);
    if (!proposal) throw new Error("expected proposal");

    const stale = validateDecision(proposal, {
      changeSetId: s.changeSetId,
      proposalVersion: 99,
      acceptedOperationIds: ["o1"],
      rejectedOperationIds: [],
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe("stale_proposal_version");
  });
});
