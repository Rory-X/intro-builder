import type { SemanticOperation } from "@intro-builder/shared/schemas";
import type { ProposalStatus } from "@intro-builder/shared/types";

/**
 * 提案卡投影（P06 任务 3）。
 *
 * plan 要求「一组任务对应一张 changeSet 卡；显示**具体位置、前后差异、理由、
 * 事实来源、批准/拒绝状态**。点击定位稳定 itemId；生成中不偷改正文。
 * **允许依赖无关组部分接受，冲突组保持可见**」。
 *
 * ## 三件最容易做错的事
 *
 * 1. **把操作列表当成「一组建议」平铺**。一组操作里常常有依赖关系：
 *    「新增一条经历」+「往这条经历里写内容」。若把两者平铺，
 *    用户可以只接受后者，而那会产生指向不存在目标的命令。
 *    这里按依赖把它分成**组**，同组只能整体接受。
 * 2. **按下标定位**。UI 点击定位必须用稳定 `itemId` ——
 *    下标在内容变化后指向别的条目，用户点「第三条经历」会跳到别的地方。
 * 3. **把「已批准」显示成「已应用」**。批准与落盘是两件事（P04 的决策路由
 *    已经用 `awaiting_commit` 表达这一点），卡片必须沿用同一区分。
 */

/** 提案卡上的一条改动。 */
export type ChangeCardItem = {
  operationId: string;
  /** 面向用户的一句话（业务语言，不含字段名与 JSON path）。 */
  label: string;
  /** 具体位置：区块 + 条目 + 字段。UI 用它做点击定位。 */
  target: {
    section: string;
    /** 稳定 itemId。不存在（单例区块）时为 null。 */
    itemId: string | null;
    field: string | null;
  };
  /** 位置的可读描述（「工作经历 · 甲公司」）。 */
  locationLabel: string;
  /** 变更前后的可读对比（有值时才显示）。 */
  before: string | null;
  after: string | null;
  /** 为什么建议这么改（来自提案 summary 或操作自带说明）。 */
  rationale: string | null;
  /**
   * 依赖的操作 id。非空时**不能**单独接受这一条 ——
   * UI 必须把它与依赖项一起处理（见 `groups`）。
   */
  dependsOn: string[];
};

/**
 * 一组必须整体接受的操作。
 *
 * 分组的依据是**插入依赖**：`insert_item` 与「指向该新条目的 set_field」
 * 必须在同一组。用户可以单独拒绝整组，但不能只接受组内一半。
 */
export type ChangeCardGroup = {
  /** 组 id（用组内第一个操作 id，稳定且可读）。 */
  id: string;
  items: ChangeCardItem[];
  /** 该组是否与当前内容冲突（冲突组必须保持可见）。 */
  hasConflict: boolean;
};

export type ChangeCard = {
  changeSetId: string;
  proposalVersion: number;
  /** 提案标题。 */
  title: string;
  status: ProposalStatus;
  groups: ChangeCardGroup[];
  /** 已接受的操作 id（来自决策记录）。 */
  accepted: string[];
  /** 已拒绝的操作 id。 */
  rejected: string[];
  /** 冲突的操作 id —— UI 必须让它们保持可见，不能折叠掉。 */
  conflicted: string[];
  /** 全部操作数，用于「已接受 N/M」这类文案。 */
  totalCount: number;
  /**
   * 是否可以实际应用（接受的操作非空且无未解决冲突）。
   *
   * 注意这**不等于**「已保存」—— 应用要走 decisions 路由并拿回执。
   */
  canApply: boolean;
};

/** 操作所作用的区块的中文名。 */
const SECTION_LABELS: Record<string, string> = {
  basics: "基本信息",
  summary: "个人总结",
  skills: "专业技能",
  awards: "奖项",
  portfolio: "作品集",
  experience: "工作经历",
  projects: "项目经历",
  education: "教育经历",
  research: "研究经历",
  custom: "自定义模块",
};

/** 字段名的中文名（只列常见的；未列出的用字段名本身）。 */
const FIELD_LABELS: Record<string, string> = {
  content: "正文",
  highlights: "正文",
  company: "公司",
  title: "职位",
  name: "名称",
  role: "角色",
  school: "学校",
  degree: "学历",
  major: "专业",
  location: "地点",
  start: "开始时间",
  end: "结束时间",
  gpa: "GPA",
  stack: "技术栈",
  link: "链接",
  paperTitle: "论文标题",
};

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? "简历内容";
}

function fieldLabel(field: string | null): string {
  if (!field) return "";
  return FIELD_LABELS[field] ?? field;
}

/**
 * 把任意值渲染成可读的短文本。
 *
 * 富文本是 TipTap 文档对象 —— 直接 JSON.stringify 会把 `{"type":"doc",...}`
 * 整段塞给用户。这里抽出其中的纯文本。
 */
function readableValue(value: unknown, depth = 0): string | null {
  /*
   * 深度保护。`insert_item.value` 在契约里是 `z.record(z.unknown())`（无界），
   * 深层嵌套会让这里的递归爆栈 —— 而这是**用户可见的渲染路径**，
   * 崩在这里比显示得简略更糟。超过 3 层就停止展开。
   */
  if (depth > 3) return null;
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => readableValue(item, depth + 1))
      .filter((text): text is string => !!text);
    return parts.length > 0 ? parts.join("、") : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "doc" && Array.isArray(record.content)) {
      const text = extractDocText(record).trim();
      return text || null;
    }
    /*
     * 普通对象（例如 `insert_item` 的 value，一条经历的多个字段）。
     *
     * 第一版这里直接 `return null`，于是「新增一条工作经历」卡片上
     * `after` 是空的 —— 用户看不到到底新增了什么，只能看到「新增」两个字。
     * 改为挑出可读的字段值拼成短摘要，跳过 id 与富文本结构。
     */
    const parts: string[] = [];
    for (const [key, fieldValue] of Object.entries(record)) {
      if (key === "id") continue;
      const text = readableValue(fieldValue, depth + 1);
      if (text) parts.push(text);
    }
    return parts.length > 0 ? parts.slice(0, 4).join(" · ") : null;
  }
  return null;
}

/** 从 TipTap doc 里抽纯文本（只读用途，不改结构）。 */
function extractDocText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content
    .map((child) =>
      child && typeof child === "object" ? extractDocText(child as Record<string, unknown>) : "",
    )
    .join("");
}

/** 逐条操作 → 卡片项。 */
function describeOperation(operation: SemanticOperation): ChangeCardItem {
  const base = {
    operationId: operation.id,
    dependsOn: [] as string[],
    rationale: null as string | null,
  };

  switch (operation.kind) {
    case "set_field": {
      const section = operation.target.section;
      const itemId = operation.target.itemId ?? null;
      const field = operation.target.field ?? null;
      /*
       * `set_field` 操作本身**不带 before 值**（条件是哈希，不是原文）。
       * 因此 `before` 为 null 是如实的 —— 展示层需要「改前」时应当从
       * 当前文档读取（`locateOperation` 给出定位），而不是从操作里编一个。
       * 第一版这里写成了 `readableValue(...) === null ? null : null`，
       * 是明显的笔误（两个分支都返回 null）；它恰好结果正确但语义混乱，
       * 因此改成显式 null 并注明原因。
       */
      return {
        ...base,
        // 单例区块写整块时没有 field，文案退化为「更新 X」。
        label: field ? `修改${fieldLabel(field)}` : `更新${sectionLabel(section)}`,
        target: { section, itemId, field },
        locationLabel: sectionLabel(section),
        before: null,
        after: readableValue(operation.value),
      };
    }

    case "insert_item":
      return {
        ...base,
        label: `新增一条${sectionLabel(operation.section)}`,
        target: { section: operation.section, itemId: operation.itemId, field: null },
        locationLabel: `新增到${sectionLabel(operation.section)}`,
        before: null,
        after: readableValue(operation.value),
      };

    case "delete_item":
      return {
        ...base,
        label: `删除一条${sectionLabel(operation.target.section)}`,
        target: {
          section: operation.target.section,
          itemId: operation.target.itemId ?? null,
          field: operation.target.field ?? null,
        },
        locationLabel: `从${sectionLabel(operation.target.section)}删除`,
        before: null,
        after: null,
      };

    case "reorder_items":
      return {
        ...base,
        label: `调整${sectionLabel(operation.section)}顺序`,
        target: { section: operation.section, itemId: null, field: null },
        locationLabel: sectionLabel(operation.section),
        before: operation.beforeIds.join("、"),
        after: operation.afterIds.join("、"),
      };

    case "set_section_order":
      return {
        ...base,
        label: "调整模块顺序",
        target: { section: "sectionOrder", itemId: null, field: null },
        locationLabel: "模块顺序",
        before: operation.before.join("、"),
        after: operation.after.join("、"),
      };

    case "set_style":
      return {
        ...base,
        label: "调整排版",
        target: { section: "styleSettings", itemId: null, field: null },
        locationLabel: "排版设置",
        before: Object.keys(operation.before).join("、") || null,
        after: Object.keys(operation.patch).join("、") || null,
      };

    case "set_title":
      return {
        ...base,
        label: "修改简历标题",
        target: { section: "title", itemId: null, field: null },
        locationLabel: "简历标题",
        before: operation.before,
        after: operation.after,
      };

    case "set_template":
      return {
        ...base,
        label: "更换模板",
        target: { section: "templateId", itemId: null, field: null },
        locationLabel: "模板",
        before: operation.before,
        after: operation.after,
      };

    default: {
      // 穷举兜底：新增操作种类时编译期报错，而不是静默产生空标签。
      const exhaustive: never = operation;
      throw new Error(`未知的操作种类：${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * 按依赖分组。
 *
 * 规则：`insert_item` 与「指向该新 itemId 的 set_field」必须在同一组。
 * 判据是看哪些操作**引用了同一个 itemId**，而不是猜语义。
 *
 * 必要性：若把两者平铺，用户可以只接受「往新经历里写内容」而拒绝「新增经历」，
 * 那会产出指向不存在目标的命令（P04 的 `validateDecision` 会拒绝，
 * 但让用户点出一个必然失败的组合是更差的体验）。
 */
function groupOperations(operations: readonly SemanticOperation[]): ChangeCardGroup[] {
  const groups: ChangeCardGroup[] = [];
  const groupIndexByItemId = new Map<string, number>();

  for (const operation of operations) {
    const itemId = operationItemId(operation);

    // 已有同 itemId 的组 → 并入（保持「插入 + 写入」同组）。
    if (itemId && groupIndexByItemId.has(itemId)) {
      const index = groupIndexByItemId.get(itemId) as number;
      groups[index].items.push(describeOperation(operation));
      continue;
    }

    const group: ChangeCardGroup = {
      id: operation.id,
      items: [describeOperation(operation)],
      hasConflict: false,
    };
    if (itemId) groupIndexByItemId.set(itemId, groups.length);
    groups.push(group);
  }

  // 补齐组内依赖声明：组内第一条之后的操作都依赖第一条。
  for (const group of groups) {
    if (group.items.length <= 1) continue;
    const first = group.items[0].operationId;
    for (let i = 1; i < group.items.length; i += 1) {
      group.items[i] = { ...group.items[i], dependsOn: [first] };
    }
  }

  return groups;
}

/** 取出操作引用的 itemId（用于分组）。 */
function operationItemId(operation: SemanticOperation): string | null {
  switch (operation.kind) {
    case "set_field":
      return operation.target.itemId ?? null;
    case "insert_item":
      return operation.itemId;
    case "delete_item":
      return operation.target.itemId ?? null;
    default:
      return null;
  }
}

export type BuildChangeCardInput = {
  changeSetId: string;
  proposalVersion: number;
  title: string;
  summary: string | null;
  status: ProposalStatus;
  operations: readonly SemanticOperation[];
  accepted?: readonly string[];
  rejected?: readonly string[];
  /** 冲突的操作 id（来自提交回执的冲突 targets）。 */
  conflicted?: readonly string[];
};

/**
 * 组装提案卡。
 *
 * 刻意**不**接收「是否已保存」作为输入：那个事实只能来自提交回执，
 * 而提案卡表达的是「建议内容与用户决策」。两者的衔接由调用方按
 * `status === "committed"` 与回执共同判断。
 */
export function buildChangeCard(input: BuildChangeCardInput): ChangeCard {
  const accepted = [...(input.accepted ?? [])];
  const rejected = [...(input.rejected ?? [])];
  const conflicted = [...(input.conflicted ?? [])];

  const groups = groupOperations(input.operations).map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      // 提案级 summary 作为理由的兜底：它对整组都适用。
      rationale: item.rationale ?? input.summary,
    })),
    hasConflict: group.items.some((item) => conflicted.includes(item.operationId)),
  }));

  /*
   * `canApply` 的三个条件缺一不可：
   * - 有接受的操作（空集没东西可应用）；
   * - 该操作不在冲突集里（冲突必须用户先处理）；
   * - 提案未被决策过（committed / rejected 是终态）。
   * 提案已 committed 时不再显示「应用」—— 那是 P04 的「冲突不标终态」对应的
   * 另一半：标了终态就不该再让人应用。
   */
  const applicableAccepted = accepted.filter((id) => !conflicted.includes(id));
  const canApply =
    applicableAccepted.length > 0 && input.status !== "committed" && input.status !== "rejected";

  return {
    changeSetId: input.changeSetId,
    proposalVersion: input.proposalVersion,
    title: input.title,
    status: input.status,
    groups,
    accepted,
    rejected,
    conflicted,
    totalCount: input.operations.length,
    canApply,
  };
}

/**
 * 冲突组是否都还可见。
 *
 * plan 要求「冲突组保持可见」—— 因此折叠逻辑必须放它们过去。
 * 单独成函数让 UI 有明确的判据，而不是在渲染时临时判断。
 */
export function visibleGroups(card: ChangeCard, options: { collapsed: boolean }): ChangeCardGroup[] {
  if (!options.collapsed) return card.groups;
  // 折叠时保留冲突组（用户必须看到它们才能处理）。
  return card.groups.filter((group) => group.hasConflict);
}

/**
 * 定位某个操作对应的稳定标识。
 *
 * UI 点击卡片项时用它跳转。返回 `itemId` 而非下标 ——
 * 下标在内容变化后指向别的条目。
 */
export function locateOperation(
  card: ChangeCard,
  operationId: string,
): { section: string; itemId: string | null; field: string | null } | null {
  for (const group of card.groups) {
    const item = group.items.find((entry) => entry.operationId === operationId);
    if (item) return item.target;
  }
  return null;
}

/**
 * 某个操作**能否单独接受**。
 *
 * 有依赖项时必须与依赖一起接受 —— UI 据此禁用单项的接受按钮，
 * 而不是让用户点出一个必然被服务端拒绝的组合。
 */
export function canAcceptIndividually(card: ChangeCard, operationId: string): boolean {
  for (const group of card.groups) {
    for (const item of group.items) {
      if (item.operationId === operationId) return item.dependsOn.length === 0;
    }
  }
  return false;
}
