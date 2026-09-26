import type { SemanticOperation } from "@intro-builder/shared/schemas";

import {
  buildAddItem,
  buildCustomSection,
  buildDeleteCustomSection,
  buildDeleteItem,
  buildReorderCustomSections,
  buildReorderItems,
  buildReorderModules,
  buildToggleModule,
  buildUpdateBasics,
  buildUpdateCustomSection,
  buildUpdateItem,
  buildUpdateStyle,
  buildWriteSingleton,
  type BuildContext,
  type ToolProposal,
} from "./resume-tools";
import { buildAllToolDeclarations } from "./resume-tools";
import { buildToolRegistry, type ToolDeclaration } from "./registry";
import { ARG_SCHEMAS, registeredToolNames } from "./arg-schemas";
import { describeSections, estimateCompleteness, readSection, type WorkspaceSnapshot } from "../workspace";

/**
 * 兼容再导出：接线自检的实现在 `arg-schemas.ts`（那里同时持有工具名 → schema 映射，
 * 而自检正需要比对三者）。既有调用方从本模块导入，故在此转发，避免调用方
 * 因为内部拆分而改 import 路径。
 */
export { assertToolWiringComplete } from "./arg-schemas";

/**
 * 工具**执行层**（P04 任务 3 + 4）。
 *
 * `resume-tools.ts` 提供的是纯函数 builder：`(工作副本, 参数) → 提案`。
 * 本模块补上它们与实际调用之间的三段接线，每段都对应一个真实缺陷：
 *
 * 1. **参数先校验再执行**。模型给的 JSON 不可信。旧实现把参数直接塞进 builder，
 *    于是越权字段（如 `id`）、超长文本、非法枚举会一路进到提交层才炸，
 *    报错也难定位。这里按工具名取对应 zod schema 解析，失败即
 *    `{ status: "failed", code: "invalid_args" }`，**不执行工具**。
 * 2. **工具必须真的注册过**。`REQUIRED_TOOL_NAMES` 里的 33 个工具在能力矩阵里
 *    逐条声明；这里要求调用名与声明一致，否则拒绝执行。这样「模型调了一个
 *    不存在的工具」不会被某个兜底分支静默吞掉。
 * 3. **写工具只产出提案，不写库**。执行层**不**调用提交 —— 提交由编排层在
 *    拿到提案后走 `commitResumeMutation`，因为只有那里才有 run fence、
 *    幂等键与真实的 CAS 回执。把提交塞进工具内部会让「同一轮两次写入」
 *    与「无回执却声称已保存」这两类问题重新出现。
 *
 * 只读工具（readResume / suggestSkills / analyzeJobMatch）直接返回 `read` 结果，
 * 让编排层把它们翻译成 `tool.succeeded` 事件而不产生任何提案。
 */

/** 已注册工具的调用入口。返回值与 `run.ts` 的 `ToolExecutionResult` 形状兼容。 */
export type ExecuteToolOutcome = ToolProposal;

/** 数组区块 → builder 需要的 section 字面量。 */
const ARRAY_SECTIONS = ["experience", "projects", "education", "research"] as const;
type ArraySectionLiteral = (typeof ARRAY_SECTIONS)[number];

/** 单例富文本工具名 → 区块。 */
const SINGLETON_TOOL_SECTIONS: Record<string, "skills" | "summary" | "awards" | "portfolio"> = {
  writeSkillsSection: "skills",
  writePersonalSummarySection: "summary",
  writeAwardsSection: "awards",
  writePortfolioSection: "portfolio",
};

/**
 * 判断某个工具名是否已被能力矩阵注册且可用。
 *
 * 每次调用都重建注册表是刻意的：注册表很小（33 条），而缓存会引入
 * 「进程内状态与声明漂移」的风险 —— 而声明漂移正是本模块要防的东西。
 */
function lookupDeclaration(toolName: string): ToolDeclaration | null {
  const registry = buildToolRegistry(buildAllToolDeclarations());
  return registry.get(toolName) ?? null;
}

/** 供调用方判断某工具是否可用（不可用则不注册给模型）。 */
export function availableToolNames(): string[] {
  return registeredToolNames();
}

/**
 * 执行一次工具调用。
 *
 * 返回 `ToolProposal`：写工具给提案、只读工具给结果、参数非法或目标缺失给 failed。
 * **不产生任何数据库副作用** —— 提交由编排层在拿到提案后负责。
 */
export function executeToolCall(input: {
  toolName: string;
  args: unknown;
  workspace: WorkspaceSnapshot;
  /** 生成操作 ID；注入以便测试稳定。 */
  newOpId: () => string;
  /** 生成新条目 ID；注入以便测试稳定。 */
  newItemId?: (prefix?: string) => string;
}): ToolProposal {
  const { toolName, args, workspace } = input;
  const ctx: BuildContext = {
    workspace,
    newOpId: input.newOpId,
    ...(input.newItemId ? { newItemId: input.newItemId } : {}),
  };

  const declaration = lookupDeclaration(toolName);
  if (!declaration) {
    return {
      status: "failed",
      code: "unknown_tool",
      message: `工具 ${toolName} 未在能力矩阵中声明，已拒绝执行`,
    };
  }

  const schema = ARG_SCHEMAS[toolName];
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    // 只回传第一条问题：列出全部会让模型难以选择要修哪一个。
    const first = parsed.error?.issues[0]?.message ?? "参数不符合要求";
    return { status: "failed", code: "invalid_args", message: `${toolName} 参数不合法：${first}` };
  }
  // 解析后的值可能带上默认值与类型收敛，必须用它而不是原始 args。
  const safeArgs = (parsed.data ?? {}) as Record<string, unknown>;

  switch (toolName) {
    // ─── 只读 ───────────────────────────────────────────────
    case "readResume": {
      const section = typeof safeArgs.section === "string" ? safeArgs.section : undefined;
      const itemId = typeof safeArgs.itemId === "string" ? safeArgs.itemId : undefined;
      if (!section) {
        return {
          status: "read",
          result: { sections: describeSections(workspace), completeness: estimateCompleteness(workspace) },
        };
      }
      const read = readSection(workspace, { section, ...(itemId ? { itemId } : {}) });
      if (!read.ok) {
        return { status: "failed", code: "target_not_found", message: read.message };
      }
      return { status: "read", result: read as unknown as Record<string, unknown> };
    }

    case "suggestSkills": {
      /*
       * 只读建议：把当前技能区块与岗位描述一起交回模型，由模型给出建议文本。
       * **不**直接改文档 —— 旧实现这里会顺手写入 skills 区块，
       * 于是一个「建议」工具变成了静默写入。
       */
      const read = readSection(workspace, { section: "skills" });
      return {
        status: "read",
        result: {
          currentSkills: read.ok ? read.fields : null,
          jobDescription: typeof safeArgs.jobDescription === "string" ? safeArgs.jobDescription : null,
          instruction: "请基于现有技能与岗位描述给出建议；需要落盘时再调用 writeSkillsSection。",
        },
      };
    }

    case "analyzeJobMatch": {
      const read = readSection(workspace, { section: "experience" });
      return {
        status: "read",
        result: {
          jobDescription: String(safeArgs.jobDescription),
          experience: read.ok ? read.fields : null,
          completeness: estimateCompleteness(workspace),
          instruction: "请逐条对应岗位要求与简历证据，区分「有证据 / 尚未体现 / 需要确认」。",
        },
      };
    }

    // ─── 提问 ───────────────────────────────────────────────
    case "askUser": {
      /*
       * 提问不产生提案：它结束本轮并进入 waiting_user。
       * 编排层据 `question` 的存在切换到等待状态，而不是继续执行后续写工具。
       */
      return {
        status: "read",
        result: {
          questionId: input.newOpId(),
          question: String(safeArgs.question),
          target: typeof safeArgs.target === "string" ? safeArgs.target : null,
        },
      };
    }

    // ─── 基础信息 / 样式 ─────────────────────────────────────
    case "updateBasicsBlock":
      return buildUpdateBasics(ctx, safeArgs);

    case "updateStyleSettingsBlock":
      return buildUpdateStyle(ctx, safeArgs);

    // ─── 模块显示 / 顺序 ─────────────────────────────────────
    case "hideResumeModule":
      return buildToggleModule(ctx, String(safeArgs.section), false);

    case "showResumeModule":
      return buildToggleModule(ctx, String(safeArgs.section), true);

    case "reorderResumeModules":
      return buildReorderModules(ctx, safeArgs);

    // ─── 自定义模块 ──────────────────────────────────────────
    case "addCustomSection":
      return buildCustomSection(ctx, safeArgs);
    case "updateCustomSectionBlock":
      return buildUpdateCustomSection(ctx, safeArgs);
    case "deleteCustomSection":
      return buildDeleteCustomSection(ctx, safeArgs);
    case "reorderCustomSections":
      return buildReorderCustomSections(ctx, { itemIds: customSectionOrderFrom(safeArgs, workspace) });

    default:
      break;
  }

  // 单例富文本
  const singletonSection = SINGLETON_TOOL_SECTIONS[toolName];
  if (singletonSection) {
    return buildWriteSingleton(ctx, singletonSection, safeArgs);
  }

  // 数组区块的四类操作
  const arrayMatch = matchArrayTool(toolName);
  if (arrayMatch) {
    const { section, action } = arrayMatch;
    switch (action) {
      case "add":
        return buildAddItem(ctx, section, safeArgs);
      case "update":
        return buildUpdateItem(ctx, section, safeArgs);
      case "remove":
        return buildDeleteItem(ctx, section, safeArgs);
      case "reorder":
        return buildReorderItems(ctx, { ...safeArgs, section });
      default:
        break;
    }
  }

  /*
   * 走到这里说明声明存在、schema 存在，但没有对应的执行分支。
   *
   * 这是接线不完整，必须显式报错而不是返回一个空提案 —— 后者会让模型
   * 以为操作成功了。加载期的 `assertToolWiringComplete` 已尽量拦住这类情况，
   * 这里是运行期的兜底（例如有人新增声明却忘了加分派）。
   */
  return {
    status: "failed",
    code: "tool_not_implemented",
    message: `工具 ${toolName} 已声明但缺少执行分支`,
  };
}

/**
 * 自定义模块排序参数适配。
 *
 * `reorderItemsArgs` 声明的是 `itemIds`，而自定义模块工具在面向模型的描述里
 * 用的是同一字段；这里保持统一的 `itemIds`，避免两套命名让模型猜。
 */
function customSectionOrderFrom(
  args: Record<string, unknown>,
  workspace: WorkspaceSnapshot,
): string[] {
  const ids = Array.isArray(args.itemIds) ? (args.itemIds as string[]) : [];
  if (ids.length > 0) return ids;
  // 兼容只给了顺序而没有 ids 的情形：按当前顺序回填，本次即为无变化。
  return workspace.current.custom.map((item) => item.id);
}

/** 把工具名解析成「数组区块 + 操作」。未匹配返回 null。 */
function matchArrayTool(
  toolName: string,
): { section: ArraySectionLiteral; action: "add" | "update" | "remove" | "reorder" } | null {
  const names: Record<ArraySectionLiteral, Record<string, "add" | "update" | "remove" | "reorder">> = {
    experience: {
      addWorkExperience: "add",
      updateWorkExperienceBlock: "update",
      deleteWorkExperience: "remove",
      reorderWorkExperiences: "reorder",
    },
    projects: {
      addProject: "add",
      updateProjectBlock: "update",
      deleteProject: "remove",
      reorderProjects: "reorder",
    },
    education: {
      addEducation: "add",
      updateEducationBlock: "update",
      deleteEducation: "remove",
      reorderEducation: "reorder",
    },
    research: {
      addResearch: "add",
      updateResearchBlock: "update",
      deleteResearch: "remove",
      reorderResearch: "reorder",
    },
  };

  for (const section of ARRAY_SECTIONS) {
    const action = names[section][toolName];
    if (action) return { section, action };
  }
  return null;
}

/** 判定一个提案是否有实际文档影响（用于「无提案不产生事件」）。 */
export function proposalTouchesDocument(proposal: ToolProposal): boolean {
  return proposal.status === "proposed" && proposal.operations.length > 0;
}

/** 提案涉及的操作（便于编排层与提交层对接）。 */
export function proposalOperations(proposal: ToolProposal): SemanticOperation[] {
  return proposal.status === "proposed" ? proposal.operations : [];
}
