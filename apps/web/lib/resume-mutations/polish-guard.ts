import { hashValue } from "@intro-builder/shared/utils";

/**
 * 润色候选的**应用前守卫**（P03 任务 5）。
 *
 * 润色是一个异步过程：用户点「AI 润色」→ 服务端生成候选 → 用户点「应用」。
 * 这两步之间存在任意长度的时间窗口，期间用户完全可能自己改了那段文字、
 * 换了条目，或者另一边（协作/Agent）改了同一处。
 *
 * 若此时直接把候选写进去，结果是**用 AI 的旧文本覆盖用户的新输入** —— 用户看到
 * 自己刚敲的字被一个「AI 建议」抹掉，而且没有任何提示。这类静默覆盖比拒绝应用更糟。
 *
 * 因此应用前必须校验候选所依据的原文是否仍然是当前内容：
 * - 一致 → 允许应用；
 * - 不一致 → 返回冲突，由 UI 提示用户重新生成或放弃。
 *
 * 纯函数，便于在没有编辑器的情况下穷举这些分支。
 */

export type PolishCandidateLike = {
  /** 生成候选时的原文（纯文本，用于展示与诊断）。 */
  originalText: string;
  /** 生成候选时原文的结构化内容；这是判定的权威依据。 */
  originalTiptapJson: unknown;
  /** 润色后的文本。 */
  polishedText: string;
  /** 服务端给出的结构化替换内容（存在时优先使用）。 */
  replacementTiptapJson?: unknown;
};

export type PolishApplyDecision =
  | {
      ok: true;
      /** 实际应写入的内容：优先结构化替换，其次由文本重建（由调用方提供）。 */
      useStructured: boolean;
      nextContent: unknown;
    }
  | {
      ok: false;
      reason: "source_changed" | "empty_candidate";
      message: string;
    };

/**
 * 判断候选是否可以安全应用。
 *
 * @param candidate      服务端返回的候选（含生成时的原文快照）
 * @param currentContent 当前编辑器的结构化内容
 */
export function decidePolishApply(
  candidate: PolishCandidateLike,
  currentContent: unknown,
): PolishApplyDecision {
  if (!candidate.polishedText && candidate.replacementTiptapJson === undefined) {
    return {
      ok: false,
      reason: "empty_candidate",
      message: "这条润色建议没有内容，无法应用",
    };
  }

  /*
   * 用结构化内容比对，而不是纯文本：
   * 纯文本相同但结构不同（列表变段落、marks 变化）时，纯文本比较会误判为「没变」，
   * 从而允许一次会**丢失格式**的应用。
   */
  const sameSource = hashValue(candidate.originalTiptapJson) === hashValue(currentContent);
  if (!sameSource) {
    return {
      ok: false,
      reason: "source_changed",
      message: "这段内容在你查看建议期间已被修改，请重新生成润色建议",
    };
  }

  if (candidate.replacementTiptapJson !== undefined) {
    return { ok: true, useStructured: true, nextContent: candidate.replacementTiptapJson };
  }
  return { ok: true, useStructured: false, nextContent: undefined };
}
