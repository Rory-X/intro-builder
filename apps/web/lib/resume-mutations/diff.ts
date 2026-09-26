import type { ArraySectionKey, ResumeContent } from "@intro-builder/shared/schemas";
import { ARRAY_SECTION_KEYS } from "@intro-builder/shared/schemas";

import { readItemIds } from "./identity";

/**
 * 结构化 Diff（P06 任务 4）。
 *
 * ## 为什么不能用现有的 `lib/resume-diff.ts`
 *
 * 那个模块只覆盖 basics 字段与富文本字段，**数组区块完全没处理**。
 * 而它的富文本比较是按**块下标**对齐的（`oldBlocks[i]` vs `newBlocks[i]`）——
 * 对「同一段落内的文字改动」是对的，但对跨条目的改动会给出误导性结果。
 *
 * 本模块补上数组区块，判据是 spec 与 plan 的四条硬要求：
 *
 * 1. **按 ID 匹配条目**，不按下标 —— 下标在下标变化后指向别的条目，
 *    于是「A 被改」会渲染成「A 被删、B 新增」。
 * 2. **明确识别移动**：两条经历只交换位置时必须报 `moved`，
 *    而不是渲染成两条互不相关的全文改写。
 * 3. **覆盖自定义模块、标题、模板、样式、sectionOrder**（现有模块全都没覆盖）。
 * 4. **历史无 ID 时标 `legacy` 并使用受限比较** —— 不能把下标对齐的结果
 *    渲染成「可信的来源证明」。
 */

/** 一条数组条目的差异。 */
export type ItemDiff = {
  itemId: string;
  /** 在旧内容里的位置（不存在为 -1）。 */
  oldIndex: number;
  /** 在新内容里的位置（不存在为 -1）。 */
  newIndex: number;
  status: "unchanged" | "modified" | "added" | "removed" | "moved";
  /** 字段级改动（仅 `modified` 时有内容）。 */
  changedFields: Array<{ field: string; before: unknown; after: unknown }>;
};

export type SectionDiff = {
  section: ArraySectionKey;
  items: ItemDiff[];
  /** 该区块是否发生了增删或重排（用于「是否显示这个区块」）。 */
  changed: boolean;
  /**
   * 该区块的比较是否**受限**。
   *
   * 当历史内容缺少稳定 ID 时为 `true`：此时只能按下标对齐，
   * 结果不足以作为「来源证明」，UI 必须明确标注这一点。
   */
  legacyComparison: boolean;
};

/** 容器级改动（不在数组区块里的那些）。 */
export type ContainerDiff = {
  title?: { before: string; after: string };
  templateId?: { before: string; after: string };
  sectionOrder?: { before: string[]; after: string[]; moved: string[] };
  styleSettings?: { before: Record<string, unknown>; after: Record<string, unknown>; changedKeys: string[] };
  /** 单例富文本字段的文本是否变化（内容级 diff 由既有 resume-diff 负责）。 */
  singletonRichText?: { field: string; changed: boolean }[];
};

export type StructuredDiff = {
  sections: SectionDiff[];
  container: ContainerDiff;
  /** 是否存在任何差异（UI 据此决定是否显示「无变化」）。 */
  hasChanges: boolean;
};

/**
 * 判断某条内容是否拥有可用的稳定 ID。
 *
 * 判据是**该区块每一条都有非空 id**。部分缺失不能算「有 ID」——
 * 混用「有 ID 的按下标、没 ID 的按下标」会让结果自相矛盾。
 */
function sectionHasStableIds(content: ResumeContent, section: ArraySectionKey): boolean {
  const items = content[section] as Array<Record<string, unknown>>;
  if (items.length === 0) return true;
  return items.every((item) => typeof item?.id === "string" && item.id.length > 0);
}

/** 读一条条目的字段快照（用于字段级比较）。 */
function itemFields(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    // id 是身份，不是「内容字段」—— 把它的变化报成字段改动会误导。
    if (key === "id") continue;
    out[key] = value;
  }
  return out;
}

/** 比较两个条目对象，返回变化的字段。 */
function diffItemFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ field: string; before: unknown; after: unknown }> {
  const beforeFields = itemFields(before);
  const afterFields = itemFields(after);
  const keys = new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)]);
  const changed: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const key of keys) {
    if (JSON.stringify(beforeFields[key]) !== JSON.stringify(afterFields[key])) {
      changed.push({ field: key, before: beforeFields[key], after: afterFields[key] });
    }
  }
  return changed;
}

/**
 * 比较一个数组区块。
 *
 * `legacyComparison` 为 true 时按下标对齐并**在结果里如实标注** ——
 * 此时不报 `moved`（没有 ID 就无法区分「移动」与「改写」，
 * 报移动会给出无法证实的结论）。
 */
function diffArraySection(
  oldContent: ResumeContent,
  newContent: ResumeContent,
  section: ArraySectionKey,
): SectionDiff {
  const oldItems = (oldContent[section] ?? []) as Array<Record<string, unknown>>;
  const newItems = (newContent[section] ?? []) as Array<Record<string, unknown>>;

  const stable = sectionHasStableIds(oldContent, section) && sectionHasStableIds(newContent, section);

  if (!stable) {
    // 受限比较：按下标对齐，并标注不可信。
    const max = Math.max(oldItems.length, newItems.length);
    const items: ItemDiff[] = [];
    for (let i = 0; i < max; i += 1) {
      const before = oldItems[i];
      const after = newItems[i];
      if (!before && after) {
        items.push({ itemId: `#${i}`, oldIndex: -1, newIndex: i, status: "added", changedFields: [] });
      } else if (before && !after) {
        items.push({ itemId: `#${i}`, oldIndex: i, newIndex: -1, status: "removed", changedFields: [] });
      } else if (before && after) {
        const changedFields = diffItemFields(before, after);
        items.push({
          itemId: `#${i}`,
          oldIndex: i,
          newIndex: i,
          status: changedFields.length > 0 ? "modified" : "unchanged",
          changedFields,
        });
      }
    }
    return {
      section,
      items,
      changed: items.some((item) => item.status !== "unchanged"),
      legacyComparison: true,
    };
  }

  /*
   * `readItemIds` 返回 `(string | null)[]`（允许部分条目没有 id）。
   * 上面 `sectionHasStableIds` 已确认两侧每条都有 id，因此这里过滤 null
   * 是安全的 —— 而不是用 `as string[]` 强转掩盖不确定性。
   */
  const oldIds = readItemIds(oldContent, section).filter((id): id is string => id !== null);
  const newIds = readItemIds(newContent, section).filter((id): id is string => id !== null);
  const oldPositions = new Map(oldIds.map((id, index) => [id, index]));
  const newPositions = new Map(newIds.map((id, index) => [id, index]));

  const items: ItemDiff[] = [];

  // 按**新顺序**遍历，保证 UI 展示顺序与当前内容一致。
  for (const id of newIds) {
    const oldIndex = oldPositions.get(id) ?? -1;
    const newIndex = newPositions.get(id) ?? -1;
    if (oldIndex < 0) {
      items.push({ itemId: id, oldIndex: -1, newIndex, status: "added", changedFields: [] });
      continue;
    }
    const changedFields = diffItemFields(oldItems[oldIndex], newItems[newIndex]);
    /*
     * 移动与改写的优先级：**先看位置是否变化**。
     *
     * 只交换位置的两条经历必须报 `moved`（plan 的用户可见验收第 4 条明确要求）。
     * 若同时改了字段，报 `modified` 并保留新位置 —— 那信息量更大，
     * 用户需要知道「挪了位置**并且**改了内容」。
     */
    if (changedFields.length > 0) {
      items.push({ itemId: id, oldIndex, newIndex, status: "modified", changedFields });
    } else if (oldIndex !== newIndex) {
      items.push({ itemId: id, oldIndex, newIndex, status: "moved", changedFields: [] });
    } else {
      items.push({ itemId: id, oldIndex, newIndex, status: "unchanged", changedFields: [] });
    }
  }

  // 被删除的条目：按旧顺序补在后面（新顺序里没有它们）。
  for (const id of oldIds) {
    if (newPositions.has(id)) continue;
    items.push({
      itemId: id,
      oldIndex: oldPositions.get(id) ?? -1,
      newIndex: -1,
      status: "removed",
      changedFields: [],
    });
  }

  return {
    section,
    items,
    changed: items.some((item) => item.status !== "unchanged"),
    legacyComparison: false,
  };
}

/**
 * 组装结构化 Diff。
 *
 * `title` / `templateId` 不在 `ResumeContent` 里（它们属于 resume 行），
 * 因此由调用方显式传入；不传则不比较这两项。
 */
export function buildStructuredDiff(
  oldContent: ResumeContent,
  newContent: ResumeContent,
  row?: { oldTitle?: string; newTitle?: string; oldTemplateId?: string; newTemplateId?: string },
): StructuredDiff {
  const sections = ARRAY_SECTION_KEYS.map((section) =>
    diffArraySection(oldContent, newContent, section),
  );

  const container: ContainerDiff = {};

  if (row?.oldTitle !== undefined && row.newTitle !== undefined && row.oldTitle !== row.newTitle) {
    container.title = { before: row.oldTitle, after: row.newTitle };
  }
  if (
    row?.oldTemplateId !== undefined &&
    row.newTemplateId !== undefined &&
    row.oldTemplateId !== row.newTemplateId
  ) {
    container.templateId = { before: row.oldTemplateId, after: row.newTemplateId };
  }

  const oldOrder = oldContent.sectionOrder ?? [];
  const newOrder = newContent.sectionOrder ?? [];
  if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
    /*
     * `moved` 只列**位置变化**的模块（集合层面）。
     *
     * 显示/隐藏（集合变化）与重排（位置变化）是两件事：前者用户看到的是
     * 「多了/少了一个模块」，后者是「顺序变了」。混在一起报会让 UI
     * 无法给出不同措辞。
     */
    const moved = oldOrder.filter((key, index) => newOrder.includes(key) && newOrder.indexOf(key) !== index);
    container.sectionOrder = { before: oldOrder, after: newOrder, moved };
  }

  const oldStyle = (oldContent.styleSettings ?? {}) as Record<string, unknown>;
  const newStyle = (newContent.styleSettings ?? {}) as Record<string, unknown>;
  const styleKeys = new Set([...Object.keys(oldStyle), ...Object.keys(newStyle)]);
  const changedKeys = [...styleKeys].filter(
    (key) => JSON.stringify(oldStyle[key]) !== JSON.stringify(newStyle[key]),
  );
  if (changedKeys.length > 0) {
    container.styleSettings = { before: oldStyle, after: newStyle, changedKeys };
  }

  const singletonFields = ["summary", "skills", "awards", "portfolio"] as const;
  const richChanges = singletonFields
    .map((field) => ({
      field,
      // 用 JSON 比较整个 doc：单例富文本是 TipTap 文档，逐字段比没有意义。
      changed: JSON.stringify(oldContent[field]) !== JSON.stringify(newContent[field]),
    }))
    .filter((entry) => entry.changed);
  if (richChanges.length > 0) container.singletonRichText = richChanges;

  const hasChanges =
    sections.some((section) => section.changed) || Object.keys(container).length > 0;

  return { sections, container, hasChanges };
}

/**
 * 从条目 diff 里挑出「仅移动」的条目。
 *
 * UI 用它渲染一句人话（「两条经历交换了位置」），而不是渲染两段全文改写。
 */
export function movedItemIds(diff: StructuredDiff): string[] {
  return diff.sections.flatMap((section) =>
    section.items.filter((item) => item.status === "moved").map((item) => item.itemId),
  );
}

/**
 * 是否存在**受限比较**的区块（历史无 ID）。
 *
 * UI 必须据此标注「这里的比较不完整」，而不是把它当可信来源展示。
 */
export function hasLegacyComparison(diff: StructuredDiff): boolean {
  return diff.sections.some((section) => section.legacyComparison && section.changed);
}
