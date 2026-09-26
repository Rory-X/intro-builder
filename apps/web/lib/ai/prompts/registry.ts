import { CORE_V1 } from "./core";
import { LEGACY_FLOATING_SYSTEM_PROMPT } from "./legacy";
import { hashPromptText, type PromptRegistration, type PromptVersion } from "./version";

/**
 * 版本登记表（P05 任务 1 + 2）。
 *
 * 每个版本号对应**一份确定的正文**与其内容哈希。用途有二：
 *
 * 1. 评测报告可以写「v1 得分 8.4」，而这句话有可验证的含义 ——
 *    哈希能证明报告里的 v1 就是仓库里的这一份文本；
 * 2. 回滚提示词时能确认「回滚到的确实是当初评测过的那一版」。
 *    只改哈希而不改文本（或反过来）都会被 `verifyRegisteredPrompts` 拦下。
 *
 * **修改任何一版的正文都必须同步更新此表的哈希**，否则加载期自检会失败。
 * 这是有意的摩擦力：改文本却不改哈希，等于让旧评测结论悄悄挂到新文本上。
 */

/** 旧稿正文（基线）。文本在 `legacy.ts`，逐字取自合并前的实现。 */
const LEGACY_TEXT = LEGACY_FLOATING_SYSTEM_PROMPT;

export const PROMPT_REGISTRY: Readonly<Record<PromptVersion, PromptRegistration>> = {
  v1: {
    version: "v1",
    description: "模块化候选稿：core + intent + 最多两条示例（plan §3–§5）",
    contentHash: "f395fe9209894092d5b5636a308e3db32df73d5f8edeb939008f011f924d1b8f",
  },
  legacy: {
    version: "legacy",
    description: "旧浮窗系统提示词（合并前实现，作为对照基线）",
    // 占位：由 `buildRegistry()` 在加载期从真实文本算出，
    // 避免把长哈希硬编码两处导致不一致。
    contentHash: "",
  },
};

/**
 * 计算并返回实际登记表。
 *
 * legacy 的哈希在这里从**真实文本**算出，而不是写死在源码里：
 * 写死会让「文本改了但哈希忘了改」变成一个需要人工发现的错误，
 * 而算出它让这种情况在加载期立即失败。
 */
function buildRegistry(): Record<PromptVersion, PromptRegistration> {
  return {
    v1: PROMPT_REGISTRY.v1,
    legacy: {
      ...PROMPT_REGISTRY.legacy,
      contentHash: hashPromptText(LEGACY_TEXT),
    },
  };
}

export const REGISTRY: Readonly<Record<PromptVersion, PromptRegistration>> = buildRegistry();

/** 取某一版的正文。未知版本抛错，不返回空串（空串会让模型失去全部约束）。 */
export function promptTextFor(version: PromptVersion): string {
  switch (version) {
    case "v1":
      return CORE_V1;
    case "legacy":
      return LEGACY_TEXT;
    default: {
      const exhaustive: never = version;
      throw new Error(`[prompts] 未知提示词版本：${String(exhaustive)}`);
    }
  }
}

/**
 * 加载期自检：登记的哈希必须与实际正文一致。
 *
 * 这是「改文本忘改哈希」的机械防线。它同时保证了另一件事：
 * 评测 runner 拿到的版本号与文本是对应的，因此报告里的分数可以归因到具体文本。
 */
export function verifyRegisteredPrompts(): void {
  for (const version of Object.keys(REGISTRY) as PromptVersion[]) {
    const registration = REGISTRY[version];
    const actual = hashPromptText(promptTextFor(version));
    if (registration.contentHash !== actual) {
      throw new Error(
        `[prompts] ${version} 的登记哈希与正文不一致。` +
          `若你确实改了这一版正文，请把 version.ts 里的 contentHash 更新为 ${actual}；` +
          `若没改，说明登记表被误改。`,
      );
    }
  }
}

verifyRegisteredPrompts();
