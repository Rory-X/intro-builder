import type { ArraySectionKey, ResumeSectionKey, SemanticOperationKind } from "@intro-builder/shared/schemas";

/**
 * 工具注册表与**能力矩阵**（P04 任务 3）。
 *
 * 旧链路把工具定义、参数 schema、执行逻辑和提示词揉在同一个 2000 行文件里，
 * 结果是「注册了一个工具，但它永远返回 unavailable」这类问题无法被机械发现 ——
 * 模型会认真调用它，然后拿到一个没用处的结果，用户看到的是「AI 说要改但没改」。
 *
 * 这里把「工具能做什么」抽成**声明式的能力矩阵**，并让注册过程严格校验：
 *
 * - 每个工具必须声明它归属哪一类能力（读 / 问 / 提案式写 / 直接写）；
 * - 写工具必须声明它**确实能完成**的操作种类与目标区块；
 * - 注册时校验「声明的能力」与「实现提供的操作」一致，不一致直接抛错。
 *
 * 判据来自 plan 的硬要求：「注册缺失能力必须报错，不能注册永远返回 unavailable 的工具」。
 */

/** 工具的能力类别。 */
export type ToolCapability =
  /** 只读：不改变任何状态。 */
  | "read"
  /** 向用户提问：不改变文档，但会结束本轮并进入 waiting_user。 */
  | "ask"
  /** 提案式写入：产出提案，等待批准或按授权直接提交。 */
  | "write";

/** 工具体现在哪个区块上。用于「模型说改了 A、实际提案指向 B」这类错配的校验。 */
export type ToolSection =
  | { kind: "singleton"; section: ResumeSectionKey }
  | { kind: "array"; section: ArraySectionKey }
  | { kind: "module-order" }
  | { kind: "style" }
  | { kind: "meta" };

export type ToolDeclaration = {
  name: string;
  /** 面向模型的说明：业务目的 + 输入限制 + 返回状态。 */
  description: string;
  capability: ToolCapability;
  /** 写工具必须声明它能产生的语义操作种类。 */
  produces?: readonly SemanticOperationKind[];
  /** 该工具作用的区块。 */
  target: ToolSection;
  /**
   * 该工具在当前运行契约下是否**可用**。
   *
   * 标记 `false` 的工具**不会被注册**（而不是注册后返回 unavailable）——
   * 这样模型不会调用它，用户也不会看到「AI 试了一下但没做成」。
   */
  available: boolean;
  /** 不可用时的原因（会写入日志，便于排查为何缺少某能力）。 */
  unavailableReason?: string;
};

export class ToolCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolCapabilityError";
  }
}

/**
 * 校验一条工具声明是否自洽。
 *
 * 这些检查会挡住三类真实缺陷：
 * 1. 写工具没有声明任何操作种类 → 它不可能产出有效命令（永远 unavailable）；
 * 2. 只读工具声明了操作种类 → 声明与实现矛盾，说明有人的意图没写对；
 * 3. 标记不可用却没有给出原因 → 排查时无从下手。
 */
export function assertToolDeclarationValid(declaration: ToolDeclaration): void {
  const { name, capability, produces, available, unavailableReason } = declaration;

  if (!name.trim()) {
    throw new ToolCapabilityError("工具必须有名字");
  }
  if (!declaration.description.trim()) {
    throw new ToolCapabilityError(`工具 ${name} 缺少面向模型的说明`);
  }

  if (capability === "write") {
    if (!produces || produces.length === 0) {
      throw new ToolCapabilityError(
        `写工具 ${name} 未声明它能产生的语义操作 —— 这类工具不可能产出有效命令，` +
          `不应被注册`,
      );
    }
  } else if (produces && produces.length > 0) {
    throw new ToolCapabilityError(
      `${capability} 工具 ${name} 声明了语义操作种类，与它的能力类别矛盾`,
    );
  }

  if (!available && !unavailableReason?.trim()) {
    throw new ToolCapabilityError(`工具 ${name} 标记为不可用，但未说明原因`);
  }
}

/**
 * 构建注册表。
 *
 * 任何一条声明不自洽就**快速失败**，而不是跳过它继续 —— 静默跳过会让
 * 「某个能力其实没注册上」变成运行时才发现的问题。
 */
export function buildToolRegistry(declarations: readonly ToolDeclaration[]): Map<string, ToolDeclaration> {
  const registry = new Map<string, ToolDeclaration>();
  for (const declaration of declarations) {
    assertToolDeclarationValid(declaration);
    if (registry.has(declaration.name)) {
      throw new ToolCapabilityError(`工具名重复：${declaration.name}`);
    }
    // 只注册可用工具：不可用的能力不出现在模型的工具列表里。
    if (!declaration.available) continue;
    registry.set(declaration.name, declaration);
  }
  return registry;
}

/** 注册表覆盖的能力摘要，用于文档与排查（不泄漏实现细节）。 */
export function summarizeCapabilities(registry: Map<string, ToolDeclaration>): {
  reads: number;
  asks: number;
  writes: number;
  writableSections: string[];
  missing: Array<{ name: string; reason: string }>;
} {
  let reads = 0;
  let asks = 0;
  let writes = 0;
  const writable = new Set<string>();

  for (const declaration of registry.values()) {
    if (declaration.capability === "read") reads += 1;
    else if (declaration.capability === "ask") asks += 1;
    else {
      writes += 1;
      writable.add(targetKey(declaration.target));
    }
  }

  return {
    reads,
    asks,
    writes,
    writableSections: [...writable].sort(),
    missing: [],
  };
}

function targetKey(target: ToolSection): string {
  if (target.kind === "singleton") return target.section;
  if (target.kind === "array") return target.section;
  return target.kind;
}

/**
 * 校验一组工具声明是否覆盖了**必需的**能力。
 *
 * plan 要求「所有现有语义工具都有能力矩阵」。这里把必需能力列成清单，
 * 缺任何一项就报错并指出缺什么 —— 而不是让缺失悄悄通过。
 */
export function assertRequiredCapabilities(
  declarations: readonly ToolDeclaration[],
): void {
  const available = new Set(
    declarations.filter((d) => d.available).map((d) => d.name),
  );
  const missing = REQUIRED_TOOL_NAMES.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new ToolCapabilityError(
      `缺少必需的工具能力：${missing.join("、")}。` +
        `这些能力必须被实现并注册，不能用「返回 unavailable 的占位工具」代替。`,
    );
  }
}

/**
 * 必需的语义工具清单（P04 任务 3 明确列出）。
 *
 * 这份清单是**契约的一部分**：新增能力要同步加进来，删除能力要显式修改这里
 * 并说明理由，不能让覆盖度悄悄退化。
 */
export const REQUIRED_TOOL_NAMES = [
  // 基础信息
  "updateBasicsBlock",
  // 各经历区块
  "addWorkExperience",
  "updateWorkExperienceBlock",
  "deleteWorkExperience",
  "reorderWorkExperiences",
  "addProject",
  "updateProjectBlock",
  "deleteProject",
  "reorderProjects",
  "addEducation",
  "updateEducationBlock",
  "deleteEducation",
  "reorderEducation",
  "addResearch",
  "updateResearchBlock",
  "deleteResearch",
  "reorderResearch",
  // 单例富文本区块
  "writeSkillsSection",
  "writePersonalSummarySection",
  "writeAwardsSection",
  "writePortfolioSection",
  // 自定义模块
  "addCustomSection",
  "updateCustomSectionBlock",
  "deleteCustomSection",
  "reorderCustomSections",
  // 样式与模块顺序
  "updateStyleSettingsBlock",
  "hideResumeModule",
  "showResumeModule",
  "reorderResumeModules",
  // 读取 / 提问 / 建议
  "readResume",
  "askUser",
  "suggestSkills",
  "analyzeJobMatch",
] as const;

/**
 * 把工具名映射到它能产生的语义操作种类。
 *
 * 这份映射是「工具声明的能力」与「提交层实际支持的操作」之间的桥：
 * 提交层只接受封闭的操作联合，而工具名是面向模型的业务词汇。两者必须显式对应，
 * 不能靠命名约定推断 —— 推断会在改名时静默失效。
 */
export const TOOL_OPERATION_MAP: Record<string, readonly SemanticOperationKind[]> = {
  updateBasicsBlock: ["set_field"],
  addWorkExperience: ["insert_item"],
  updateWorkExperienceBlock: ["set_field"],
  deleteWorkExperience: ["delete_item"],
  reorderWorkExperiences: ["reorder_items"],
  addProject: ["insert_item"],
  updateProjectBlock: ["set_field"],
  deleteProject: ["delete_item"],
  reorderProjects: ["reorder_items"],
  addEducation: ["insert_item"],
  updateEducationBlock: ["set_field"],
  deleteEducation: ["delete_item"],
  reorderEducation: ["reorder_items"],
  addResearch: ["insert_item"],
  updateResearchBlock: ["set_field"],
  deleteResearch: ["delete_item"],
  reorderResearch: ["reorder_items"],
  writeSkillsSection: ["set_field"],
  writePersonalSummarySection: ["set_field"],
  writeAwardsSection: ["set_field"],
  writePortfolioSection: ["set_field"],
  addCustomSection: ["insert_item"],
  updateCustomSectionBlock: ["set_field"],
  deleteCustomSection: ["delete_item"],
  reorderCustomSections: ["reorder_items"],
  updateStyleSettingsBlock: ["set_style"],
  hideResumeModule: ["set_section_order"],
  showResumeModule: ["set_section_order"],
  reorderResumeModules: ["set_section_order"],
};

/**
 * 校验「工具 → 操作」映射覆盖了全部写工具。
 *
 * 缺映射的写工具会在提交时才发现「不知道该产生什么命令」。这里提前挡住。
 */
export function assertOperationMapCoversWrites(
  declarations: readonly ToolDeclaration[],
): void {
  const writeTools = declarations
    .filter((d) => d.capability === "write" && d.available)
    .map((d) => d.name);
  const missing = writeTools.filter((name) => !TOOL_OPERATION_MAP[name]);
  if (missing.length > 0) {
    throw new ToolCapabilityError(
      `以下写工具没有对应的语义操作映射，提交时无法产出有效命令：${missing.join("、")}`,
    );
  }
}
