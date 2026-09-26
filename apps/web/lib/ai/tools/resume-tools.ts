import { z } from "zod";
import type { SemanticOperation, Target } from "@intro-builder/shared/schemas";
import { hashTargetValue } from "@intro-builder/shared/schemas";

import { createItemId } from "../../resume-mutations/item-id";
import { findItemIndexById } from "../../resume-mutations/identity";
import { conditionHashFor, readSection, type WorkspaceSnapshot } from "../workspace";
import { TOOL_OPERATION_MAP, type ToolDeclaration, type ToolSection } from "./registry";

/**
 * 业务工具的**新实现**（P04 任务 3）。
 *
 * 与旧实现（`app/api/agent/floating/chat/route.ts` 的 2000 行）的关键差别：
 *
 * 1. **按稳定 ID 定位，不再用 `index`**。旧工具的参数里带 `index: number`，
 *    提案生成与用户操作之间一旦发生排序或增删，这个下标就指向别的条目 ——
 *    甲的建议被写进乙（F03）。
 * 2. **工具只产出提案，不直接写库**。写库由 `commitResumeMutation` 统一负责，
 *    因此每条修改都带前置条件与幂等键。
 * 3. **前置条件哈希由服务端从工作副本重算**，不接受模型传入的 `beforePlainText`。
 *    旧实现把模型给的展示文本当条件用，模型一旦编造，冲突检测就形同虚设。
 * 4. **返回值区分「提案」与「已提交」**。没有回执就不是已保存。
 *
 * 本模块是纯函数：输入（工作副本 + 参数）→ 输出（提案）。执行与提交在编排层。
 */

// ─── 参数 schema ─────────────────────────────────────────────

/** 所有写工具共有的语义参数。刻意**不收** `beforePlainText`：条件由服务端算。 */
const commonWriteArgs = {
  changeSummary: z.string().max(200).optional().describe("一句话说明这次改了什么"),
};

const richTextArg = z
  .string()
  .max(20000)
  .optional()
  .describe("简历正文纯文本。不要输出 HTML 标签；列表用换行或 '- ' 开头。");

function textField(description: string) {
  return z.string().max(500).optional().describe(description);
}

export const basicsBlockArgs = z.object({
  name: textField("姓名"),
  status: textField("当前状态，例如「在职」"),
  title: textField("目标职位"),
  email: textField("邮箱"),
  phone: textField("电话"),
  location: textField("所在地"),
  website: textField("个人主页"),
  summary: textField("一句话自我介绍（纯文本）"),
  photo: textField("头像地址"),
  ...commonWriteArgs,
});

export const styleSettingsArgs = z.object({
  fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
  fontSize: z.number().min(8).max(16).optional(),
  lineHeight: z.number().min(1.05).max(2).optional(),
  bodyLineHeight: z.number().min(1.05).max(2).optional(),
  headingGap: z.number().min(0).max(32).optional(),
  pagePadding: z.number().min(8).max(60).optional(),
  sectionGap: z.number().min(4).max(24).optional(),
  itemGap: z.number().min(2).max(16).optional(),
  photoScale: z.number().min(0.5).max(1.5).optional(),
  ...commonWriteArgs,
});

/** 单例富文本区块：只有内容。 */
export const singletonRichTextArgs = z.object({
  content: richTextArg.describe("该区块的正文"),
  ...commonWriteArgs,
});

/** 新增条目：只给值，ID 由服务端生成（模型不能指定身份）。 */
export const addExperienceArgs = z.object({
  company: textField("公司名"),
  title: textField("职位"),
  start: textField("开始时间"),
  end: textField("结束时间"),
  location: textField("地点"),
  content: richTextArg.describe("职责与成果"),
  ...commonWriteArgs,
});

export const addProjectArgs = z.object({
  name: textField("项目名"),
  role: textField("角色"),
  location: textField("地点"),
  start: textField("开始时间"),
  end: textField("结束时间"),
  stack: z.array(z.string().max(60)).max(30).optional().describe("技术栈"),
  link: textField("项目链接"),
  content: richTextArg.describe("项目描述"),
  ...commonWriteArgs,
});

export const addEducationArgs = z.object({
  school: textField("学校"),
  degree: textField("学历"),
  major: textField("专业"),
  location: textField("地点"),
  start: textField("开始时间"),
  end: textField("结束时间"),
  gpa: textField("GPA 或成绩说明"),
  highlights: richTextArg.describe("在校经历"),
  ...commonWriteArgs,
});

export const addResearchArgs = z.object({
  name: textField("研究/课题名"),
  role: textField("角色"),
  location: textField("地点"),
  start: textField("开始时间"),
  end: textField("结束时间"),
  paperTitle: textField("论文标题"),
  link: textField("链接"),
  content: richTextArg.describe("研究内容"),
  ...commonWriteArgs,
});

/** 更新条目：**必须**给 itemId（不是 index）。 */
export const updateItemArgs = z.object({
  itemId: z.string().min(1).max(128).describe("要修改的条目 ID，来自 readResume 的返回"),
  company: textField("公司名"),
  title: textField("职位"),
  name: textField("名称"),
  role: textField("角色"),
  school: textField("学校"),
  degree: textField("学历"),
  major: textField("专业"),
  location: textField("地点"),
  start: textField("开始时间"),
  end: textField("结束时间"),
  gpa: textField("GPA"),
  stack: z.array(z.string().max(60)).max(30).optional(),
  link: textField("链接"),
  paperTitle: textField("论文标题"),
  content: richTextArg,
  highlights: richTextArg,
  ...commonWriteArgs,
});

export const itemIdArgs = z.object({
  itemId: z.string().min(1).max(128).describe("目标条目 ID，来自 readResume 的返回"),
  ...commonWriteArgs,
});

export const reorderItemsArgs = z.object({
  section: z.enum(["experience", "projects", "education", "research", "custom"]),
  itemIds: z.array(z.string().min(1).max(128)).min(1).max(200).describe("按目标顺序排列的完整条目 ID 列表"),
  ...commonWriteArgs,
});

export const addCustomSectionArgs = z.object({
  title: z.string().min(1).max(100).describe("模块标题"),
  content: richTextArg,
  ...commonWriteArgs,
});

export const customSectionArgs = z.object({
  sectionId: z.string().min(1).max(128).describe("自定义模块 ID，来自 readResume 的返回"),
  title: textField("模块标题"),
  content: richTextArg,
  ...commonWriteArgs,
});

export const moduleOrderArgs = z.object({
  sectionOrder: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(200)
    .describe("完整的模块顺序列表（含所有模块）"),
  ...commonWriteArgs,
});

export const readResumeArgs = z.object({
  section: z
    .string()
    .min(1)
    .max(128)
    .describe("要读取的区块名；自定义模块用 custom:<id>")
    .optional(),
  itemId: z.string().min(1).max(128).optional().describe("只读某一条目时给出其 ID"),
});

export const askUserArgs = z.object({
  question: z.string().min(1).max(500).describe("只问一个最有价值的问题"),
  target: z.string().max(200).optional().describe("这个问题针对的位置，便于用户定位"),
});

export const suggestSkillsArgs = z.object({
  jobDescription: z.string().max(8000).optional().describe("目标岗位描述，用于判断技能缺口"),
});

export const analyzeJobMatchArgs = z.object({
  jobDescription: z.string().min(1).max(8000).describe("目标岗位描述原文"),
});

// ─── 提案构建结果 ────────────────────────────────────────────

export type ToolProposal =
  | { status: "proposed"; operations: SemanticOperation[]; summary: string; note?: string }
  | { status: "failed"; code: string; message: string }
  /** 只读结果：直接返回给模型，不产生提案。 */
  | { status: "read"; result: Record<string, unknown> };

export type BuildContext = {
  workspace: WorkspaceSnapshot;
  /** 生成操作 ID（注入以便测试稳定）。 */
  newOpId: () => string;
  /** 生成新条目 ID（注入以便测试稳定）。 */
  newItemId?: () => string;
};

function opId(ctx: BuildContext): string {
  return ctx.newOpId();
}

/** 把纯文本转成 TipTap doc（与提交层的中间表示一致）。 */
export function textToDoc(text: string): Record<string, unknown> {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  // 以 "- " 开头的行构成无序列表；其余合成段落。
  const bullets = lines.filter((line) => line.startsWith("- "));
  if (bullets.length === lines.length) {
    return {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: bullets.map((line) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: line.slice(2) }] }],
          })),
        },
      ],
    };
  }
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

/** 目标不存在时的统一错误。 */
function targetMissing(target: Target): ToolProposal {
  const label = target.field ? `${target.section}.${target.field}` : target.section;
  return {
    status: "failed",
    code: "target_not_found",
    message: `找不到目标 ${label}。请先用 readResume 确认当前的条目 ID。`,
  };
}

/**
 * 构造字段更新提案。
 *
 * 条件哈希从**工作副本**重算 —— 模型无法编造前置条件。
 */
export function buildSetFieldOperations(
  ctx: BuildContext,
  target: Target,
  values: Record<string, unknown>,
  summary: string,
): ToolProposal {
  const expected = conditionHashFor(ctx.workspace, target);
  if (expected === null) return targetMissing(target);

  return {
    status: "proposed",
    operations: [
      {
        id: opId(ctx),
        kind: "set_field",
        target,
        condition: { expectedValueHash: expected },
        value: values,
      },
    ],
    summary,
  };
}

// ─── 各工具的实现 ────────────────────────────────────────────

const BASICS_FIELDS = [
  "name",
  "status",
  "title",
  "email",
  "phone",
  "location",
  "website",
  "summary",
  "photo",
] as const;

export function buildUpdateBasics(
  ctx: BuildContext,
  args: Record<string, unknown>,
): ToolProposal {
  const operations: SemanticOperation[] = [];
  for (const field of BASICS_FIELDS) {
    if (args[field] === undefined) continue;
    const target: Target = { section: "basics", field };
    const expected = conditionHashFor(ctx.workspace, target);
    // 目标不存在（字段尚未出现过）时跳过，而不是整条提案失败 ——
    // 基础信息里某些字段可能从未被写过，那不该阻塞其他字段的更新。
    if (expected === null) continue;
    operations.push({
      id: opId(ctx),
      kind: "set_field",
      target,
      condition: { expectedValueHash: expected },
      value: args[field],
    });
  }
  if (operations.length === 0) {
    return { status: "failed", code: "no_change", message: "没有给出要更新的基础信息字段" };
  }
  return {
    status: "proposed",
    operations,
    summary: String(args.changeSummary ?? "更新基础信息"),
  };
}

/** 单例富文本区块（只有 content 字段）。 */
export type SingletonSection = "skills" | "summary" | "awards" | "portfolio";

export function buildWriteSingleton(
  ctx: BuildContext,
  section: SingletonSection,
  args: Record<string, unknown>,
): ToolProposal {
  const content = args.content;
  if (typeof content !== "string") {
    return { status: "failed", code: "no_content", message: "没有给出要写入的正文" };
  }
  const expected = conditionHashFor(ctx.workspace, { section });
  if (expected === null) return targetMissing({ section });
  return {
    status: "proposed",
    operations: [
      {
        id: opId(ctx),
        kind: "set_field",
        target: { section, field: "content" },
        condition: { expectedValueHash: expected },
        value: textToDoc(content),
      },
    ],
    summary: String(args.changeSummary ?? `更新${section}`),
  };
}

const ARRAY_SECTION_FIELDS: Record<string, readonly string[]> = {
  experience: ["company", "title", "start", "end", "location"],
  projects: ["name", "role", "location", "start", "end", "stack", "link"],
  education: ["school", "degree", "major", "location", "start", "end", "gpa"],
  research: ["name", "role", "location", "start", "end", "paperTitle", "link"],
};

const RICH_TEXT_FIELD: Record<string, string> = {
  experience: "content",
  projects: "content",
  education: "highlights",
  research: "content",
};

/** 现有条目的 ID 顺序（插入锚点与顺序条件都用它）。 */
function currentIds(ctx: BuildContext, section: string): string[] {
  const read = readSection(ctx.workspace, { section });
  if (!read.ok) return [];
  const items = Array.isArray(read.fields) ? (read.fields as Array<Record<string, unknown>>) : [];
  return items
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => id !== null);
}

export function buildAddItem(
  ctx: BuildContext,
  section: "experience" | "projects" | "education" | "research",
  args: Record<string, unknown>,
): ToolProposal {
  const ids = currentIds(ctx, section);
  const itemId = (ctx.newItemId ?? createItemId)();
  const fields = ARRAY_SECTION_FIELDS[section] ?? [];
  const richField = RICH_TEXT_FIELD[section] ?? "content";

  const value: Record<string, unknown> = { id: itemId };
  for (const field of fields) {
    if (args[field] !== undefined) value[field] = args[field];
  }
  if (typeof args[richField] === "string") value[richField] = textToDoc(args[richField]);

  return {
    status: "proposed",
    operations: [
      {
        id: opId(ctx),
        kind: "insert_item",
        section,
        itemId,
        // 追加到末尾。
        afterItemId: ids.length > 0 ? ids[ids.length - 1] : null,
        expectedOrderHash: hashOrder(ids),
        value,
      },
    ],
    summary: String(args.changeSummary ?? `新增一条${section}`),
    note: `新条目 ID：${itemId}`,
  };
}

/**
 * ID 顺序的规范化哈希。
 *
 * 直接复用 shared 的 `hashTargetValue`，与提交层 `prepare.ts` 的 `orderHash`
 * 是**同一个实现** —— 顺序前置条件必须两边算法一致，否则插入永远报 order_mismatch。
 * （此前这里绕了一层可替换的间接实现，既无必要，也埋下了算法漂移的风险。）
 */
function hashOrder(ids: string[]): string {
  return hashTargetValue(ids);
}

export function buildUpdateItem(
  ctx: BuildContext,
  section: "experience" | "projects" | "education" | "research",
  args: Record<string, unknown>,
): ToolProposal {
  const itemId = typeof args.itemId === "string" ? args.itemId : "";
  if (!itemId) {
    return { status: "failed", code: "missing_item_id", message: "必须给出 itemId（不是下标）" };
  }
  const index = findItemIndexById(ctx.workspace.current, section as never, itemId);
  if (index < 0) {
    return {
      status: "failed",
      code: "target_not_found",
      message: `找不到条目 ${itemId}。请先用 readResume 确认当前的条目 ID。`,
    };
  }

  const fields = ARRAY_SECTION_FIELDS[section] ?? [];
  const richField = RICH_TEXT_FIELD[section] ?? "content";
  const operations: SemanticOperation[] = [];

  for (const field of fields) {
    if (args[field] === undefined) continue;
    const target: Target = { section: section as never, itemId, field };
    const expected = conditionHashFor(ctx.workspace, target);
    if (expected === null) continue;
    operations.push({
      id: opId(ctx),
      kind: "set_field",
      target,
      condition: { expectedValueHash: expected },
      value: args[field],
    });
  }

  if (typeof args[richField] === "string") {
    const target: Target = { section: section as never, itemId, field: richField };
    const expected = conditionHashFor(ctx.workspace, target);
    if (expected !== null) {
      operations.push({
        id: opId(ctx),
        kind: "set_field",
        target,
        condition: { expectedValueHash: expected },
        value: textToDoc(args[richField]),
      });
    }
  }

  if (operations.length === 0) {
    return { status: "failed", code: "no_change", message: "没有给出要更新的字段" };
  }
  return {
    status: "proposed",
    operations,
    summary: String(args.changeSummary ?? `更新条目 ${itemId}`),
  };
}

export function buildDeleteItem(
  ctx: BuildContext,
  section: "experience" | "projects" | "education" | "research",
  args: Record<string, unknown>,
): ToolProposal {
  const itemId = typeof args.itemId === "string" ? args.itemId : "";
  if (!itemId) {
    return { status: "failed", code: "missing_item_id", message: "必须给出 itemId（不是下标）" };
  }
  const target: Target = { section: section as never, itemId };
  // 删除是破坏性的：条件用**整条内容**，确保删的就是当时那条。
  const expected = conditionHashFor(ctx.workspace, target);
  if (expected === null) return targetMissing(target);

  return {
    status: "proposed",
    operations: [
      {
        id: opId(ctx),
        kind: "delete_item",
        target,
        condition: { expectedValueHash: expected },
      },
    ],
    summary: String(args.changeSummary ?? `删除条目 ${itemId}`),
  };
}

export function buildReorderItems(
  ctx: BuildContext,
  args: Record<string, unknown>,
): ToolProposal {
  const section = String(args.section ?? "");
  const itemIds = Array.isArray(args.itemIds) ? (args.itemIds as string[]) : [];
  const current = currentIds(ctx, section);

  // 集合必须一致：增删由别的工具负责，排序不隐含增删。
  const sameSet =
    current.length === itemIds.length && current.every((id) => itemIds.includes(id));
  if (!sameSet) {
    return {
      status: "failed",
      code: "order_set_mismatch",
      message:
        `排序必须覆盖当前全部条目且不增不减。当前条目：${current.join("、") || "（无）"}`,
    };
  }

  return {
    status: "proposed",
    operations: [
      {
        id: opId(ctx),
        kind: "reorder_items",
        section: section as never,
        beforeIds: current,
        afterIds: itemIds,
      },
    ],
    summary: String(args.changeSummary ?? `调整${section}顺序`),
  };
}

export function buildUpdateStyle(ctx: BuildContext, args: Record<string, unknown>): ToolProposal {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(styleSettingsArgs.shape)) {
    if (key === "changeSummary") continue;
    if (args[key] !== undefined) patch[key] = args[key];
  }
  if (Object.keys(patch).length === 0) {
    return { status: "failed", code: "no_change", message: "没有给出要调整的排版项" };
  }
  const current = ((ctx.workspace.current.styleSettings ?? {}) as Record<string, unknown>);
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = current[key];

  return {
    status: "proposed",
    operations: [{ id: opId(ctx), kind: "set_style", before, patch }],
    summary: String(args.changeSummary ?? "调整排版"),
  };
}

/** 模块显示/隐藏通过 sectionOrder 表达（隐藏不等于删除正文）。 */
export function buildToggleModule(
  ctx: BuildContext,
  section: string,
  visible: boolean,
): ToolProposal {
  const current = [...ctx.workspace.current.sectionOrder];
  const present = current.includes(section);
  if (visible && present) {
    return { status: "failed", code: "no_change", message: `模块 ${section} 已经显示` };
  }
  if (!visible && !present) {
    return { status: "failed", code: "no_change", message: `模块 ${section} 已经隐藏` };
  }
  const after = visible ? [...current, section] : current.filter((key) => key !== section);
  return {
    status: "proposed",
    operations: [
      { id: opId(ctx), kind: "set_section_order", before: current, after },
    ],
    summary: visible ? `显示模块 ${section}` : `隐藏模块 ${section}`,
  };
}

export function buildReorderModules(
  ctx: BuildContext,
  args: Record<string, unknown>,
): ToolProposal {
  const order = Array.isArray(args.sectionOrder) ? (args.sectionOrder as string[]) : [];
  const current = [...ctx.workspace.current.sectionOrder];
  const sameSet = current.length === order.length && current.every((key) => order.includes(key));
  if (!sameSet) {
    return {
      status: "failed",
      code: "order_set_mismatch",
      message: `模块顺序必须覆盖当前全部模块且不增不减。当前：${current.join("、")}`,
    };
  }
  return {
    status: "proposed",
    operations: [{ id: opId(ctx), kind: "set_section_order", before: current, after: order }],
    summary: String(args.changeSummary ?? "调整模块顺序"),
  };
}

export function buildCustomSection(
  ctx: BuildContext,
  args: Record<string, unknown>,
): ToolProposal {
  const title = typeof args.title === "string" ? args.title : "";
  if (!title) return { status: "failed", code: "missing_title", message: "自定义模块必须有标题" };
  const sectionId = (ctx.newItemId ?? createItemId)("sec");
  const ids = ctx.workspace.current.custom.map((item) => item.id);

  return {
    status: "proposed",
    operations: [
      {
        id: opId(ctx),
        kind: "insert_item",
        section: "custom",
        itemId: sectionId,
        afterItemId: ids.length > 0 ? ids[ids.length - 1] : null,
        expectedOrderHash: hashOrder(ids),
        value: {
          id: sectionId,
          title,
          content: typeof args.content === "string" ? textToDoc(args.content) : textToDoc(""),
        },
      },
    ],
    summary: String(args.changeSummary ?? `新增自定义模块「${title}」`),
    note: `新模块 ID：${sectionId}`,
  };
}

// ─── 工具声明（能力矩阵的实例） ──────────────────────────────

type ArraySection = "experience" | "projects" | "education" | "research";

const ARRAY_LABELS: Record<ArraySection, string> = {
  experience: "工作/实习经历",
  projects: "项目经历",
  education: "教育经历",
  research: "研究经历",
};

/**
 * 数组区块的工具名。
 *
 * 刻意**显式列表**而不是按规则拼单复数：字符串拼接会产出 `addProjects`、
 * `addEducations`、`reorderProjects` 这类与契约清单不符的名字（实测被注册表的
 * 必需能力校验抓到）。工具名是面向模型的契约，改名会静默破坏提示词与映射。
 */
const ARRAY_TOOL_NAMES: Record<
  ArraySection,
  { add: string; update: string; remove: string; reorder: string }
> = {
  experience: {
    add: "addWorkExperience",
    update: "updateWorkExperienceBlock",
    remove: "deleteWorkExperience",
    reorder: "reorderWorkExperiences",
  },
  projects: {
    add: "addProject",
    update: "updateProjectBlock",
    remove: "deleteProject",
    reorder: "reorderProjects",
  },
  education: {
    add: "addEducation",
    update: "updateEducationBlock",
    remove: "deleteEducation",
    reorder: "reorderEducation",
  },
  research: {
    add: "addResearch",
    update: "updateResearchBlock",
    remove: "deleteResearch",
    reorder: "reorderResearch",
  },
};

/** 生成数组区块的四个工具（新增/更新/删除/排序）。 */
export function arraySectionToolDeclarations(section: ArraySection): ToolDeclaration[] {
  const label = ARRAY_LABELS[section];
  const target: ToolSection = { kind: "array", section };
  const names = ARRAY_TOOL_NAMES[section];
  return [
    {
      name: names.add,
      description: `新增一条${label}。只提供字段值，条目 ID 由服务端生成。`,
      capability: "write",
      produces: ["insert_item"],
      target,
      available: true,
    },
    {
      name: names.update,
      description: `更新一条${label}。必须给出 itemId（来自 readResume），不是下标。`,
      capability: "write",
      produces: ["set_field"],
      target,
      available: true,
    },
    {
      name: names.remove,
      description: `删除一条${label}。必须给出 itemId。`,
      capability: "write",
      produces: ["delete_item"],
      target,
      available: true,
    },
    {
      name: names.reorder,
      description: `调整${label}的顺序。必须提供当前全部条目的 ID。`,
      capability: "write",
      produces: ["reorder_items"],
      target,
      available: true,
    },
  ];
}

/** 全部工具声明（供注册表使用）。 */
export function buildAllToolDeclarations(): ToolDeclaration[] {
  const declarations: ToolDeclaration[] = [
    {
      name: "readResume",
      description:
        "读取简历的区块或单条条目。不给 section 时返回目录（各区块条目数与条目 ID）。",
      capability: "read",
      target: { kind: "meta" },
      available: true,
    },
    {
      name: "askUser",
      description: "向用户提一个最有价值的问题。会结束本轮并等待回答。",
      capability: "ask",
      target: { kind: "meta" },
      available: true,
    },
    {
      name: "updateBasicsBlock",
      description: "更新基础信息（姓名、联系方式、职位等）。",
      capability: "write",
      produces: ["set_field"],
      target: { kind: "singleton", section: "basics" },
      available: true,
    },
    {
      name: "updateStyleSettingsBlock",
      description: "调整排版（字号、行高、页边距等）。",
      capability: "write",
      produces: ["set_style"],
      target: { kind: "style" },
      available: true,
    },
    {
      name: "hideResumeModule",
      description: "隐藏某个模块（不删除正文）。",
      capability: "write",
      produces: ["set_section_order"],
      target: { kind: "module-order" },
      available: true,
    },
    {
      name: "showResumeModule",
      description: "重新显示某个模块。",
      capability: "write",
      produces: ["set_section_order"],
      target: { kind: "module-order" },
      available: true,
    },
    {
      name: "reorderResumeModules",
      description: "调整模块顺序。必须提供当前全部模块。",
      capability: "write",
      produces: ["set_section_order"],
      target: { kind: "module-order" },
      available: true,
    },
    {
      name: "addCustomSection",
      description: "新增一个自定义模块。",
      capability: "write",
      produces: ["insert_item"],
      target: { kind: "array", section: "custom" },
      available: true,
    },
    {
      name: "updateCustomSectionBlock",
      description: "更新自定义模块的标题或正文。必须给出 sectionId。",
      capability: "write",
      produces: ["set_field"],
      target: { kind: "array", section: "custom" },
      available: true,
    },
    {
      name: "deleteCustomSection",
      description: "删除一个自定义模块。必须给出 sectionId。",
      capability: "write",
      produces: ["delete_item"],
      target: { kind: "array", section: "custom" },
      available: true,
    },
    {
      name: "reorderCustomSections",
      description: "调整自定义模块顺序。",
      capability: "write",
      produces: ["reorder_items"],
      target: { kind: "array", section: "custom" },
      available: true,
    },
    {
      name: "suggestSkills",
      description: "根据目标岗位给技能建议。只读，不修改文档。",
      capability: "read",
      target: { kind: "singleton", section: "skills" },
      available: true,
    },
    {
      name: "analyzeJobMatch",
      description: "把岗位要求与简历证据逐条对应，区分「有证据 / 尚未体现 / 需要确认」。只读。",
      capability: "read",
      target: { kind: "meta" },
      available: true,
    },
  ];

  for (const section of ["experience", "projects", "education", "research"] as const) {
    declarations.push(...arraySectionToolDeclarations(section));
  }

  const singletonNames: Array<[string, "skills" | "summary" | "awards" | "portfolio"]> = [
    ["writeSkillsSection", "skills"],
    ["writePersonalSummarySection", "summary"],
    ["writeAwardsSection", "awards"],
    ["writePortfolioSection", "portfolio"],
  ];
  for (const [name, section] of singletonNames) {
    declarations.push({
      name,
      description: `写入${section}区块的正文。`,
      capability: "write",
      produces: ["set_field"],
      target: { kind: "singleton", section },
      available: true,
    });
  }

  return declarations;
}

/** 工具名 → 操作种类的映射（由注册表校验覆盖度）。 */
export function toolOperationMap(): Record<string, readonly SemanticOperation["kind"][]> {
  return { ...TOOL_OPERATION_MAP };
}
