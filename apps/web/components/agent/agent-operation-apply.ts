import type { ResumeOperation } from "@intro-builder/shared/types";

export const AGENT_APPLY_ERROR_MESSAGE = "这条 Agent 建议暂不支持自动应用";

export type AgentOperationApplyResult =
  | {
      ok: true;
      rollback: () => void;
      commit?: () => void;
    }
  | { ok: false };

export type ApplyAgentOperation = (
  operation: ResumeOperation,
) => AgentOperationApplyResult | boolean | void;

export function tryApplyAgentOperation(
  applyOperation: ApplyAgentOperation,
  operation: ResumeOperation,
  logScope: string,
): AgentOperationApplyResult {
  try {
    const result = applyOperation(operation);
    if (result === false) {
      return { ok: false };
    }
    if (result === undefined || result === true) {
      return { ok: true, rollback: () => undefined };
    }
    return result;
  } catch (error) {
    console.error(`[${logScope}] local apply failed`, error);
    return { ok: false };
  }
}

export function rollbackAppliedOperations(
  appliedOperations: AgentOperationApplyResult[],
  logScope: string,
) {
  for (const result of [...appliedOperations].reverse()) {
    if (!result.ok) continue;
    try {
      result.rollback();
    } catch (error) {
      console.error(`[${logScope}] local rollback failed`, error);
    }
  }
}

export function commitAppliedOperations(
  appliedOperations: AgentOperationApplyResult[],
  logScope: string,
) {
  for (const result of appliedOperations) {
    if (!result.ok || !result.commit) continue;
    try {
      result.commit();
    } catch (error) {
      console.error(`[${logScope}] local commit failed`, error);
    }
  }
}
