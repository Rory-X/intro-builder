import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  describeDecisionOutcome,
  getProposal,
  recordDecision,
  setProposalStatus,
  validateDecision,
} from "@/lib/ai/change-set";
import { commitResumeMutation } from "@/lib/resume-mutations/commit";
import type { ProposalStatus } from "@intro-builder/shared/types";

/**
 * change-set 决策路由（P04 任务 4）。
 *
 * 这个路由负责「用户批准/拒绝对话里提出的修改」。它的核心不是把操作写进文档，
 * 而是**守住两条区分**：
 *
 * 1. **批准 ≠ 已保存**。批准只写 `resume_decision`（绑定精确的 proposalVersion）；
 *    真正改文档由 `commitResumeMutation` 完成。若提交遇到 revision 冲突，
 *    决策记录仍然成立，但响应必须是 `awaiting_commit` —— UI 要显示
 *    「已确认，尚未保存」，**不能**显示「已批准并应用」。
 * 2. **提案版本必须精确匹配**。AI 可能在这期间重新生成提案；用旧版本做的批准
 *    会落在已经不存在的内容上。版本不符一律 409，且**不产生任何落盘副作用**。
 *
 * 归属校验基于会话里的 userId，不信任请求体自称的身份；他人的 changeSet 返回
 * 404 而不是 403 —— 403 会泄露「这个 changeSetId 存在」。
 */

function assertServerRuntime(): void {
  const nodeVersion = (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions?.node;
  if (!nodeVersion) {
    throw new Error("api/ai/change-sets 只能在服务端使用");
  }
}
assertServerRuntime();

/** 校验决策请求体的形状。任何不合法一律 400，绝不「尽力解释」。 */
function parseDecisionBody(body: unknown):
  | { ok: true; proposalVersion: number; accepted: string[]; rejected: string[] }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "请求体必须是 JSON 对象" };
  }
  const record = body as Record<string, unknown>;

  const version = record.proposalVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: "proposalVersion 必须是正整数" };
  }

  const readIds = (value: unknown, field: string): string[] | { error: string } => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return { error: `${field} 必须是字符串数组` };
    if (value.some((id) => typeof id !== "string" || !id)) {
      return { error: `${field} 只能包含非空字符串` };
    }
    return value as string[];
  };

  const accepted = readIds(record.acceptedOperationIds, "acceptedOperationIds");
  if (!Array.isArray(accepted)) return { ok: false, message: accepted.error };
  const rejected = readIds(record.rejectedOperationIds, "rejectedOperationIds");
  if (!Array.isArray(rejected)) return { ok: false, message: rejected.error };

  return { ok: true, proposalVersion: version, accepted, rejected };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ changeSetId: string }> },
) {
  const { changeSetId } = await context.params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = parseDecisionBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  const proposal = await getProposal(changeSetId);
  // 不存在与不属于当前用户都返回 404：403 会泄露存在性。
  if (!proposal || proposal.userId !== userId) {
    return NextResponse.json({ error: "找不到该提案" }, { status: 404 });
  }

  const validation = validateDecision(proposal, {
    changeSetId,
    proposalVersion: parsed.proposalVersion,
    acceptedOperationIds: parsed.accepted,
    rejectedOperationIds: parsed.rejected,
  });

  if (!validation.ok) {
    /*
     * 版本不符是**客户端可恢复**的状态：用户应看到新内容后重新确认。
     * 用 409 而不是 400（那不是格式错误）或 500（那不是服务端故障）。
     * 关键：此处**尚未**写任何决策，因此不会把批准挂到旧版本上。
     */
    const status = validation.code === "stale_proposal_version" ? 409 : 400;
    return NextResponse.json(
      { code: validation.code, error: validation.message, applied: false },
      { status },
    );
  }

  const decision = await recordDecision({
    id: crypto.randomUUID(),
    changeSetId,
    proposalVersion: parsed.proposalVersion,
    acceptedOperationIds: validation.accepted.map((op) => op.id),
    rejectedOperationIds: validation.rejectedIds,
    userId,
  });

  /*
   * 决策没落库就绝不能继续提交：否则会出现「文档改了但没有任何批准记录」，
   * 事后无法解释这次修改是谁、基于哪一版批准的。
   */
  if (!decision.recorded) {
    return NextResponse.json(
      { error: "决策未能保存，请重试", applied: false },
      { status: 409 },
    );
  }

  // 全部拒绝：决策成立、文档不动。这是终态，不是失败。
  if (validation.accepted.length === 0) {
    await setProposalStatus(changeSetId, "rejected");
    const outcome = describeDecisionOutcome({
      acceptedCount: 0,
      rejectedCount: validation.rejectedIds.length,
      committedCount: 0,
      lastCommitStatus: null,
    });
    return NextResponse.json({ ...outcome, applied: false });
  }

  /*
   * 提交接受的操作。
   *
   * `expectedRevision` 用提案创建时的基准版本：这样「用户看到提案后又手动改了正文」
   * 会走冲突分支（而不是把 AI 的修改盖在用户的新输入上）。
   */
  const commitOutcome = await commitResumeMutation(
    {
      userId,
      actorName: session?.user?.name ?? "用户",
      source: "agent",
      runId: proposal.runId,
      changeSetId,
      changeSetVersion: parsed.proposalVersion,
      summary: proposal.summary ?? proposal.title,
    },
    {
      mutationId: `decision-${changeSetId}-${parsed.proposalVersion}`,
      resumeId: proposal.resumeId,
      expectedRevision: proposal.baseRevision,
      operations: validation.accepted,
      changeSetId,
      changeSetVersion: parsed.proposalVersion,
    },
  );

  const committed = commitOutcome.status === "committed";
  const outcome = describeDecisionOutcome({
    acceptedCount: validation.accepted.length,
    rejectedCount: validation.rejectedIds.length,
    // 提交是整批一次，因此要么全部落盘要么没有。
    committedCount: committed ? validation.accepted.length : 0,
    lastCommitStatus: commitOutcome.status,
    revision: committed ? commitOutcome.result.revision : undefined,
  });

  /*
   * 只有真正拿到回执才标记提案终态。
   *
   * 冲突时**保持** `pending`：用户修正冲突后还应能再次应用同一提案，
   * 把它标成 committed 会让提案永久无法重试。
   */
  if (committed) {
    await setProposalStatus(changeSetId, "committed");
  } else if (outcome.status === "partially_committed") {
    await setProposalStatus(changeSetId, "partially_committed" satisfies ProposalStatus);
  }

  return NextResponse.json({
    ...outcome,
    // `applied` 仅在文档真的落盘且拿到回执时为 true。
    applied: committed,
    mutationId: committed ? commitOutcome.result.mutationId : null,
    receipt: committed
      ? { mutationId: commitOutcome.result.mutationId, revision: commitOutcome.result.revision }
      : null,
  });
}
