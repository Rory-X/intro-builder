import { commitResumeMutation } from "../resume-mutations/commit";
import type { ToolProposal } from "./tools/resume-tools";
import type { ToolExecutionResult } from "./run";

/**
 * 把工具提案落盘（P04 任务 4 的直接模式）。
 *
 * 这是「提案 → 真实提交 → 回执」的接线点，也是 P04 里最后一块「不写库就等于没改」
 * 的缺口。三条不可让步的约束：
 *
 * 1. **没有回执就不是已保存**。只有 `commitResumeMutation` 返回
 *    `status: "committed"`（带 `mutationId` + `revision`）才把结果标成已落盘。
 *    冲突 / 拒绝 / 无变化必须如实回报，绝不能因为「模型说改了」就当作成功 ——
 *    这正是规格 F04 与 P03 反复修掉的同一类假成功。
 * 2. **fence 必须透传**。提交语句会在 CTE 内核验「该 Run 仍可写」。
 *    取消与提交可能并发，只有把 fence 交给数据库，才能让「取消先成功则禁止提交」
 *    成立。调用方之外的任何一层都**不能**用「我写之前查过一次」替代它。
 * 3. **幂等键在一次逻辑提交内固定**。重试必须复用同一个 `mutationId` 与同一份
 *    payload；否则服务端无法把重试识别为幂等重放，而会当成第二次修改。
 *    这里由调用方传入 mutationId（同一 toolCallId 派生），重试时得到同一个值。
 *
 * 审批模式不由本模块处理：那时工具只产出提案并结束本轮，
 * 用户批准走 `api/ai/change-sets/[id]/decisions`。
 */

/** 提交所需的可信上下文。全部由服务端构造，**不**取自请求体或模型输出。 */export type CommitProposalInput = {
  proposal: Extract<ToolProposal, { status: "proposed" }>;
  resumeId: string;
  userId: string;
  actorName: string;
  /** 提交时使用的 CAS 基准版本（来自加载时读到的 revision）。 */
  expectedRevision: number;
  /** 本次 Run 的 fencing 令牌；缺省表示不持有租约（此时不应写入）。 */
  fence: { runId: string; fenceToken: number } | null;
  runId: string;
  /** 幂等键。同一 toolCallId 的重试必须复用同一个值。 */
  mutationId: string;
  changeSetId?: string | null;
};

/**
 * 把提交层的拒绝原因码转成面向模型的说明。
 *
 * 模型需要知道**为什么**被拒才能改对；只回一个 code 会让它反复重试同样的
 * 非法操作。未知 code 原样带出，不编造解释。
 */
function describeRejection(code: string): string {
  const known: Record<string, string> = {
    invalid_command: "修改命令不符合契约，可能包含不被允许的字段或目标",
    idempotency_key_reuse: "同一个幂等键被用于不同的修改内容，请求已拒绝",
    not_found: "简历不存在或无权访问",
    revision_mismatch: "简历版本已变化，请基于最新内容重新确认",
    run_not_writable: "本次执行已取消或被接管，修改未被保存",
  };
  return known[code] ?? `修改被拒绝（${code}）`;
}

/**
 * 提交一次提案。
 *
 * 返回值与 `run.ts` 的 `ToolExecutionResult` 对齐，便于直接交给编排层：
 * 只有 `succeeded` 分支里带 `mutationId` + `revision` 时，编排层才会发出
 * `mutation.committed` 事件并推进工作副本基准。
 */
export async function commitToolProposal(
  input: CommitProposalInput,
): Promise<ToolExecutionResult> {
  const { proposal } = input;

  if (proposal.operations.length === 0) {
    // 空提案不是错误，但也不能报成功 —— 没有任何东西会被写入。
    return { status: "failed", code: "empty_proposal", message: "提案不包含任何操作" };
  }

  const outcome = await commitResumeMutation(
    {
      userId: input.userId,
      actorName: input.actorName,
      source: "agent",
      runId: input.runId,
      // fence 是「取消能拦住晚到提交」的唯一实现点。
      fence: input.fence,
      changeSetId: input.changeSetId ?? null,
      summary: proposal.summary,
    },
    {
      mutationId: input.mutationId,
      resumeId: input.resumeId,
      expectedRevision: input.expectedRevision,
      operations: proposal.operations,
      ...(input.changeSetId ? { changeSetId: input.changeSetId } : {}),
    },
  );

  switch (outcome.status) {
    case "committed":
      return {
        status: "succeeded",
        result: {
          saved: true,
          summary: proposal.summary,
          operationCount: proposal.operations.length,
        },
        // 真实回执：编排层据此发出 mutation.committed 并推进基准。
        mutationId: outcome.result.mutationId,
        revision: outcome.result.revision,
      };

    case "conflict":
      /*
       * 冲突：文档在别处被改过，本次修改**没有**落盘。
       *
       * 报 `failed` 而不是伪造成功。用户需要看到「内容已变化，请重新确认」，
       * 而不是以为改动生效了。
       */
      return {
        status: "failed",
        code: "revision_conflict",
        message:
          `简历内容已在别处更新（当前版本 ${outcome.result.currentRevision}），` +
          "本次修改未保存，请基于最新内容重新确认",
      };

    case "no_change":
      // 提案与现状一致：没有写入，但也不是失败。如实说明，避免谎称已保存。
      return {
        status: "succeeded",
        result: { saved: false, reason: "no_change", summary: proposal.summary },
      };

    case "rejected":
      /*
       * 契约只给出 `code`（没有 message）。这里把 code 转成面向模型的说明，
       * 并保留 code 本身 —— 模型需要知道**为什么**被拒才能改对。
       */
      return {
        status: "failed",
        code: outcome.result.code,
        message: describeRejection(outcome.result.code),
      };

    default: {
      // 穷举兜底：新增状态时这里会编译期报错，而不是静默返回 undefined。
      const exhaustive: never = outcome;
      return {
        status: "failed",
        code: "unknown_commit_outcome",
        message: `未知的提交结果：${JSON.stringify(exhaustive)}`,
      };
    }
  }
}
