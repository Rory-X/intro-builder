import type { ZodType } from "zod";

import {
  addCustomSectionArgs,
  addEducationArgs,
  addExperienceArgs,
  addProjectArgs,
  addResearchArgs,
  analyzeJobMatchArgs,
  askUserArgs,
  basicsBlockArgs,
  customSectionArgs,
  itemIdArgs,
  moduleOrderArgs,
  moduleToggleArgs,
  readResumeArgs,
  reorderItemsArgs,
  singletonRichTextArgs,
  styleSettingsArgs,
  suggestSkillsArgs,
  updateItemArgs,
} from "./resume-tools";
import { buildAllToolDeclarations } from "./resume-tools";
import { TOOL_OPERATION_MAP, assertRequiredCapabilities, buildToolRegistry } from "./registry";

/**
 * 工具名 → 参数 schema（P04 任务 3）。
 *
 * 单独成模块是为了让两个消费方共享同一份映射，而不互相牵连：
 *
 * - `tools/execute.ts` —— 执行前校验模型给的参数；
 * - `tools/sdk.ts` —— 把 schema 交给 AI SDK，让模型知道每个工具的形状。
 *
 * 若把这份映射留在 `execute.ts` 里，`sdk.ts` 就得 import 它，
 * 于是单元测试 mock `execute` 时会连带把 schema 也 mock 掉 —— 那会让
 * 「工具真的注册给了模型」这件事失去测试覆盖。
 */

export const ARG_SCHEMAS: Record<string, ZodType> = {
  readResume: readResumeArgs,
  askUser: askUserArgs,
  updateBasicsBlock: basicsBlockArgs,
  updateStyleSettingsBlock: styleSettingsArgs,
  addWorkExperience: addExperienceArgs,
  addProject: addProjectArgs,
  addEducation: addEducationArgs,
  addResearch: addResearchArgs,
  updateWorkExperienceBlock: updateItemArgs,
  updateProjectBlock: updateItemArgs,
  updateEducationBlock: updateItemArgs,
  updateResearchBlock: updateItemArgs,
  deleteWorkExperience: itemIdArgs,
  deleteProject: itemIdArgs,
  deleteEducation: itemIdArgs,
  deleteResearch: itemIdArgs,
  reorderWorkExperiences: reorderItemsArgs,
  reorderProjects: reorderItemsArgs,
  reorderEducation: reorderItemsArgs,
  reorderResearch: reorderItemsArgs,
  writeSkillsSection: singletonRichTextArgs,
  writePersonalSummarySection: singletonRichTextArgs,
  writeAwardsSection: singletonRichTextArgs,
  writePortfolioSection: singletonRichTextArgs,
  addCustomSection: addCustomSectionArgs,
  updateCustomSectionBlock: customSectionArgs,
  deleteCustomSection: customSectionArgs,
  reorderCustomSections: reorderItemsArgs,
  hideResumeModule: moduleToggleArgs,
  showResumeModule: moduleToggleArgs,
  reorderResumeModules: moduleOrderArgs,
  suggestSkills: suggestSkillsArgs,
  analyzeJobMatch: analyzeJobMatchArgs,
};

/**
 * 自检：声明、参数 schema、必需清单、操作映射四者必须一致。
 *
 * 在模块加载时跑一次。任何一条缺失都直接抛错，而不是等到某个工具被调用时
 * 才表现为「看起来不可用」—— 那样模型会反复重试同一件事。
 */
export function assertToolWiringComplete(): void {
  const declarations = buildAllToolDeclarations();
  assertRequiredCapabilities(declarations);

  const declaredNames = new Set(declarations.map((d) => d.name));
  const missingSchema = [...declaredNames].filter((name) => !ARG_SCHEMAS[name]);
  if (missingSchema.length > 0) {
    throw new Error(
      `[tools] 以下工具已声明但没有参数 schema，模型调用会无法校验：${missingSchema.join("、")}`,
    );
  }

  const extraSchema = Object.keys(ARG_SCHEMAS).filter((name) => !declaredNames.has(name));
  if (extraSchema.length > 0) {
    throw new Error(
      `[tools] 以下工具名有 schema 但未在能力矩阵声明，属死代码：${extraSchema.join("、")}`,
    );
  }

  /*
   * 写工具必须有「工具名 → 操作种类」映射。
   *
   * 没有映射意味着提交层不知道该工具的提案是否合法，只能放行或全部拒绝；
   * 两者都错。这里在加载期就拦住。
   */
  const missingMap = declarations
    .filter((d) => d.capability === "write")
    .filter((d) => (TOOL_OPERATION_MAP[d.name] ?? []).length === 0)
    .map((d) => d.name);
  if (missingMap.length > 0) {
    throw new Error(`[tools] 以下写工具缺少操作种类映射：${missingMap.join("、")}`);
  }
}

// 模块加载即自检：接线不完整时让问题在启动时暴露。
assertToolWiringComplete();

/** 只有注册表认可的可用工具才应交给模型。 */
export function registeredToolNames(): string[] {
  return [...buildToolRegistry(buildAllToolDeclarations()).keys()];
}
