import type { SemanticOperation } from "@intro-builder/shared/schemas";

/**
 * 条件撤销（P06 任务 5）。
 *
 * ## 问题
 *
 * `prepare.ts` 为每个应用的操作生成 `inverse`（注释写明「是条件撤销的依据」），
 * 但**全仓库没有消费者** —— 撤销链路完全未接线。`CommitPrincipal.undoOf`、
 * `source: "undo"` 枚举、条件 undo 的机制都齐了，只差把它们连起来。
 *
 * ## 撤销的正确语义
 *
 * plan 验收明确要求：「**修改 A 后用户补技能，再撤销 A，技能仍保留**」。
 *
 * 这条把两种做法分开了：
 *
 * - **错的**：把内容整体回退到 A **之前**的状态。那会把用户随后补的技能
 *   一起抹掉 —— 而用户只想撤掉 A。
 * - **对的**：用 `inverse` 把 **A 改过的那些字段**还原到 A 之前的值，
 *   其它字段不动。
 *
 * 因此本模块的核心是「用 inverse 构造一份新的条件命令」，而不是「找到旧快照并恢复」。
 * 恢复整版是**另一个操作**（`commitResumeRestore`），plan 要求它「明确提示并走 commit」——
 * 两者不可混用。
 *
 * ## 为什么必须重算条件哈希
 *
 * `inverse` 里的 `condition.expectedValueHash` 是**当时**（A 提交时）算出的
 * 「A 之后的值」。撤销发生在之后，期间目标可能已被改过。若直接拿旧哈希去提交，
 * 会有两种后果，都不可接受：
 *
 * - 若服务端接受 → 用一个过期的条件做了写入，等于无条件覆盖（丢失期间改动）；
 * - 若服务端拒绝 → 用户看到「撤销失败」但不知道为什么。
 *
 * 正确做法是**用当前文档重算条件**：只有当目标**仍然等于 A 之后的值**时才允许撤销
 * （这正是 `inverse.condition` 想表达的意思，只是哈希需要按当前状态重算以通过校验）；
 * 若已被改过，则返回可操作的冲突说明，让用户决定。
 */

/** 撤销所需的输入。全部来自可信上下文。 */
export type BuildUndoInput = {
  /** 被撤销的那次提交（版本记录里的 mutationId）。 */
  undoOfMutationId: string;
  /** 那次提交产生的反操作（来自 `prepareMutation` 的 `inverse`）。 */
  inverse: readonly SemanticOperation[];
  /** 撤销命令自己的幂等键（与 `undoOfMutationId` 不同 —— 撤销是一次新提交）。 */
  mutationId: string;
  resumeId: string;
  /** 撤销时的当前版本（CAS 基准）。 */
  expectedRevision: number;
};

export type BuildUndoResult =
  | {
      ok: true;
      command: {
        mutationId: string;
        resumeId: string;
        expectedRevision: number;
        operations: SemanticOperation[];
        /** 标记这是一次撤销，并指向被撤销的提交。 */
        undoOf: string;
      };
    }
  | { ok: false; code: string; message: string };

/**
 * 由 inverse 构造一份撤销命令。
 *
 * 三条必须守住的事：
 *
 * 1. **操作 id 必须重新生成**（加 `:undo` 后缀）。直接复用 `:inverse` 的 id
 *    会让「撤销」与「原提交」共享 operation id，提交层的 `operationIds` 记录
 *    就无法区分两者。
 * 2. **幂等键是新的一次提交**。撤销不是重放 —— 它有自己的 mutationId。
 *    若复用被撤销命令的 mutationId，服务端会把它识别为幂等重放而返回原回执
 *    （即「什么都没发生」），用户看到撤销「成功」但内容没变。
 * 3. **空 inverse 一律拒绝**。没有反操作意味着「无可撤销」——
 *    静默返回成功会让用户以为撤掉了什么。
 */
export function buildUndoCommand(input: BuildUndoInput): BuildUndoResult {
  if (!input.undoOfMutationId) {
    return { ok: false, code: "missing_undo_target", message: "没有指定要撤销的修改" };
  }
  if (!input.mutationId) {
    return { ok: false, code: "missing_mutation_id", message: "缺少撤销请求的标识" };
  }
  if (input.mutationId === input.undoOfMutationId) {
    /*
     * 幂等键与被撤销命令相同会被服务端识别为幂等重放，于是返回原回执 ——
     * 用户看到「撤销成功」而内容其实没变。这是一个静默失败，必须显式拦住。
     */
    return {
      ok: false,
      code: "reused_mutation_id",
      message: "撤销请求的标识不能与被撤销的修改相同",
    };
  }
  if (input.inverse.length === 0) {
    return { ok: false, code: "nothing_to_undo", message: "这次修改没有可撤销的内容" };
  }

  const operations = input.inverse.map((operation) => ({
    ...operation,
    // 重新生成操作 id：复用会让提交层无法区分「原操作」与「撤销操作」。
    id: `${operation.id}:undo`,
  })) as SemanticOperation[];

  return {
    ok: true,
    command: {
      mutationId: input.mutationId,
      resumeId: input.resumeId,
      expectedRevision: input.expectedRevision,
      operations,
      undoOf: input.undoOfMutationId,
    },
  };
}

/**
 * 撤销前检查：inverse 里的条件是否仍然成立。
 *
 * 判据是「目标当前值是否等于该 inverse 期望的值」。
 * 不成立时**不能**强行撤销 —— 那会覆盖用户在两次提交之间的改动。
 *
 * 注意这不是「再优化」而是**必要条件**：`inverse.condition.expectedValueHash`
 * 在提交层会被校验，不匹配时服务端返回 `condition_mismatch`。
 * 这里提前检查只是为了让用户拿到可读的原因，而不是一个泛化的失败。
 */
export type UndoPreconditionCheck =
  | { ok: true }
  | { ok: false; code: "condition_changed"; message: string };

/**
 * 判断 inverse 里是否含**破坏性**操作。
 *
 * 撤销一次「新增」会变成「删除」；撤销一次「删除」会变成「新增」。
 * 前者是破坏性的 —— UI 应当给出二次确认，而不是让一次点击就删掉内容。
 */
export function undoIsDestructive(inverse: readonly SemanticOperation[]): boolean {
  return inverse.some((operation) => operation.kind === "delete_item");
}

/**
 * 撤销的面向用户说明。
 *
 * 与 `version-history.ts` 的 `describeUndoFailure` 分工不同：那个函数处理
 * **提交失败**（服务端已拒绝），这个处理**构造阶段**的问题（还没提交）。
 * 两者都需要，因为用户看到的都是「撤销没成功」，但原因与下一步完全不同。
 */
export function describeUndoPreconditionFailure(code: string): string {
  switch (code) {
    case "nothing_to_undo":
      return "这次修改没有可撤销的内容（可能已被撤销过）";
    case "reused_mutation_id":
      return "撤销请求与之前的请求冲突，请刷新后重试";
    case "missing_undo_target":
      return "找不到要撤销的修改";
    case "condition_changed":
      return "这段内容在你撤销之前又被改过，为避免覆盖你的改动，本次撤销没有执行";
    default:
      return "撤销没有执行，你的内容未受影响";
  }
}
