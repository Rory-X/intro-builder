import { hashValue } from "@intro-builder/shared/utils";

/**
 * 提示词版本与内容哈希（P05 任务 2）。
 *
 * ## 为什么提示词需要一个「版本」而不是只靠 git
 *
 * 契约要求「promptVersion 独立配置，保留上一版，指标退化可**只回滚提示词**」。
 * 只靠 git 做不到这件事：回滚提示词要么整体 revert 一次提交（会连代码一起退），
 * 要么手工改回文本（改回的是不是当初那一版，没人能证明）。
 *
 * 因此每个版本带一个**内容哈希**：运行时把当前文本重新哈希，与登记的
 * `contentHash` 比对。两者不一致说明「这个版本号对应的文本被人改过了」——
 * 此时回滚毫无意义（回滚到的不是当初评测过的那一版）。
 *
 * 这是把「评测结论对应哪一版文本」变成可验证的事实，而不是靠约定。
 */

/** 提示词版本标识。当前只有 v1（候选稿）与 legacy（旧稿基线）。 */
export type PromptVersion = "v1" | "legacy";

export type PromptRegistration = {
  version: PromptVersion;
  /** 面向人的说明，写在日志与评测报告里。 */
  description: string;
  /** 该版本正文的内容哈希（SHA-256 十六进制）。 */
  contentHash: string;
};

/**
 * 内容哈希：对文本做规范化后哈希。
 *
 * 规范化只做一件事：统一换行符并去掉首尾空白。
 * **不**去掉中间空格或折叠空行 —— 那会让「两个不同文本哈希相同」，
 * 而哈希的全部价值就在于能区分它们。
 */
export function hashPromptText(text: string): string {
  return hashValue(text.replace(/\r\n/g, "\n").trim());
}

/**
 * 校验一段文本是否确实是登记的某一版。
 *
 * 返回 `ok: false` 时调用方**必须**拒绝把它用于评测对照 ——
 * 拿一个改过的文本去对比，得到的结论不能归因给那个版本号。
 */
export function verifyPromptVersion(
  version: PromptVersion,
  text: string,
  registry: Readonly<Record<PromptVersion, PromptRegistration>>,
): { ok: true } | { ok: false; reason: string } {
  const registration = registry[version];
  if (!registration) {
    return { ok: false, reason: `未登记的提示词版本：${version}` };
  }
  const actual = hashPromptText(text);
  if (actual !== registration.contentHash) {
    return {
      ok: false,
      reason:
        `提示词 ${version} 的正文与登记哈希不一致（登记 ${registration.contentHash}，` +
        `实际 ${actual}）。这通常意味着版本号对应的文本被改过 —— ` +
        `回滚到该版本已不能保证回到评测过的那一份。`,
    };
  }
  return { ok: true };
}
