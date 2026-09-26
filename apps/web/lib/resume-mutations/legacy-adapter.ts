import type {
  ResumeContent,
  SemanticOperation,
  Target,
} from "@intro-builder/shared/schemas";
import { hashTargetValue } from "@intro-builder/shared/schemas";
import type { ResumeOperation } from "@intro-builder/shared/types";

/**
 * 旧 `ResumeOperation` → 新 `SemanticOperation` 的**兼容映射**。
 *
 * 历史聊天记录里存的是旧结构（`fieldPath: "experience.0.content"` 这种**下标地址**）。
 * 这些提案不能盲目重放：下标在生成之后可能已经指向另一条经历，直接套用就会把
 * 甲的建议写进乙（F03）。
 *
 * 因此映射规则只有一条：
 * - **只**在旧提案能对应到当前内容里的稳定 ID 时才映射；
 * - 凡是必须靠下标猜 ID 的（数组长度变了、顺序变了、下标越界），一律返回
 *   `stale`，让 UI 显示「内容已更新，请重新生成」，而不是猜一个 ID 继续。
 *
 * 注意：这里刻意不处理 `insert_section` 的「凭空创建条目到第 N 个下标」语义 ——
 * 新契约要求显式 itemId 与相邻锚点，信息不足时应当失败而不是编造。
 */

export type LegacyMappingContext = {
  content: ResumeContent;
  /** 旧提案生成时所依据的基准 revision；必须与当前一致才允许映射。 */
  baseRevision: number;
  currentRevision: number;
  /** 生成新条目 ID 的能力由调用方注入。 */
  newItemId: () => string;
};

export type LegacyMappingResult =
  | { ok: true; operations: SemanticOperation[] }
  | {
      ok: false;
      reason: "stale" | "unsupported" | "revision_mismatch";
      /** 面向用户的中文说明，直接可展示。 */
      message: string;
    };

const ARRAY_SECTION = /^(experience|projects|education|research|custom)\.(\d+)(?:\.([A-Za-z][A-Za-z0-9]*))?$/;
const SINGLETON_FIELD = /^(basics|summary|skills|awards|portfolio)(?:\.([A-Za-z][A-Za-z0-9]*))?$/;
const STYLE_FIELD = /^styleSettings(?:\.([A-Za-z][A-Za-z0-9]*))?$/;

const STALE_MESSAGE = "内容已更新，请重新生成这条建议";

function stale(message = STALE_MESSAGE): LegacyMappingResult {
  return { ok: false, reason: "stale", message };
}

function sectionItems(content: ResumeContent, section: string): Array<Record<string, unknown>> {
  const raw = (content as unknown as Record<string, unknown>)[section];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function itemIdAt(content: ResumeContent, section: string, index: number): string | null {
  const items = sectionItems(content, section);
  const item = items[index];
  const id = item?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** 旧提案的 after 值：优先结构化值，其次纯文本。 */
function legacyValue(operation: ResumeOperation): unknown {
  if (operation.replacementTiptapJson !== undefined) return operation.replacementTiptapJson;
  if (operation.replacementValue !== undefined) return operation.replacementValue;
  return operation.afterPlainText;
}

/**
 * 把一条旧 operation 映射为新命令。
 *
 * 返回 `ok: false` 时**不要**尝试降级重试；调用方应把 `message` 展示给用户。
 */
export function mapLegacyOperation(
  operation: ResumeOperation,
  context: LegacyMappingContext,
): LegacyMappingResult {
  if (context.baseRevision !== context.currentRevision) {
    return {
      ok: false,
      reason: "revision_mismatch",
      message: "这条提案基于更早的版本，请基于当前内容重新生成",
    };
  }

  switch (operation.operation) {
    case "reorder_sections":
      return mapReorderSections(operation, context);
    case "reorder_items":
      return mapReorderItems(operation, context);
    case "delete_section":
      return mapDelete(operation, context);
    case "update_section":
    case "insert_section":
      return mapWrite(operation, context);
    default:
      return { ok: false, reason: "unsupported", message: "这种旧操作无法安全迁移，请重新生成" };
  }
}

function mapReorderSections(
  operation: ResumeOperation,
  context: LegacyMappingContext,
): LegacyMappingResult {
  const after = operation.sectionOrder;
  if (!Array.isArray(after)) return stale();
  const before = context.content.sectionOrder;
  const beforeSorted = [...before].sort();
  const afterSorted = [...after].sort();
  if (
    beforeSorted.length !== afterSorted.length ||
    beforeSorted.some((key, i) => key !== afterSorted[i])
  ) {
    return stale("模块列表已变化，请重新生成这条建议");
  }
  return {
    ok: true,
    operations: [
      {
        id: operation.id,
        kind: "set_section_order",
        before,
        after: [...after],
      },
    ],
  };
}

function mapReorderItems(
  operation: ResumeOperation,
  context: LegacyMappingContext,
): LegacyMappingResult {
  const section = operation.section;
  if (!isArraySection(section)) return stale();
  const order = operation.itemOrder;
  if (!Array.isArray(order)) return stale();

  const items = sectionItems(context.content, section);
  const currentIds = items
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => id !== null);
  if (currentIds.length !== items.length) {
    // 有条目缺 ID，无法保证旧下标与身份对应。
    return stale("条目身份尚未初始化，请刷新后重试");
  }

  // 旧 itemOrder 可能是下标或（较新版本里的）ID，两边都尝试，但**只**在下标集合
  // 完整且无重复时才接受下标解释。
  const afterIds: string[] = [];
  const indexOrder: number[] = [];
  let usesIndexes = true;
  for (const entry of order) {
    if (typeof entry === "number" || /^\d+$/.test(String(entry))) {
      const index = Number(entry);
      if (!Number.isInteger(index) || index < 0 || index >= items.length) return stale();
      indexOrder.push(index);
    } else {
      usesIndexes = false;
      const id = String(entry);
      if (!currentIds.includes(id)) return stale();
      afterIds.push(id);
    }
  }

  let resolved: string[];
  if (usesIndexes) {
    if (new Set(indexOrder).size !== indexOrder.length) return stale();
    if (indexOrder.length !== items.length) return stale();
    resolved = indexOrder.map((index) => currentIds[index]);
  } else {
    if (afterIds.length !== currentIds.length) return stale();
    resolved = afterIds;
  }

  const sameSet =
    [...resolved].sort().length === [...currentIds].sort().length &&
    [...resolved].sort().every((id, i) => id === [...currentIds].sort()[i]);
  if (!sameSet) return stale("条目集合已变化，请重新生成这条建议");

  return {
    ok: true,
    operations: [
      {
        id: operation.id,
        kind: "reorder_items",
        section,
        beforeIds: currentIds,
        afterIds: resolved,
      },
    ],
  };
}

function isArraySection(
  section: string,
): section is "experience" | "projects" | "education" | "research" | "custom" {
  return ["experience", "projects", "education", "research", "custom"].includes(section);
}

function mapDelete(
  operation: ResumeOperation,
  context: LegacyMappingContext,
): LegacyMappingResult {
  const match = ARRAY_SECTION.exec(operation.fieldPath);
  if (!match) {
    // 单例区块的「删除」在新契约里等于清空内容，必须显式区分；信息不足时失败。
    return { ok: false, reason: "unsupported", message: "旧版删除操作无法安全迁移，请重新生成" };
  }
  const [, section, indexText, field] = match;
  const index = Number(indexText);
  const itemId = itemIdAt(context.content, section, index);
  if (!itemId) return stale();

  const items = sectionItems(context.content, section);
  const item = items[index];
  if (field !== undefined) {
    // `x.0.content` 的删除语义是清空该字段。
    if (item[field] === undefined) return stale();
    return {
      ok: true,
      operations: [
        {
          id: operation.id,
          kind: "set_field",
          target: { section: section as never, itemId, field } as Target,
          condition: { expectedValueHash: hashTargetValue(item[field]) },
          value: field === "content" || field === "highlights" ? { type: "doc", content: [] } : "",
        },
      ],
    };
  }

  return {
    ok: true,
    operations: [
      {
        id: operation.id,
        kind: "delete_item",
        target: { section: section as never, itemId } as Target,
        condition: { expectedValueHash: hashTargetValue(item) },
      },
    ],
  };
}

function mapWrite(
  operation: ResumeOperation,
  context: LegacyMappingContext,
): LegacyMappingResult {
  const value = legacyValue(operation);

  const styleMatch = STYLE_FIELD.exec(operation.fieldPath);
  if (styleMatch) {
    const patch =
      styleMatch[1] !== undefined
        ? { [styleMatch[1]]: value }
        : ((operation.replacementValue ?? {}) as Record<string, unknown>);
    if (Object.keys(patch).length === 0) return stale();
    const current: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      current[key] = (context.content.styleSettings as Record<string, unknown> | undefined)?.[key];
    }
    return {
      ok: true,
      operations: [{ id: operation.id, kind: "set_style", before: current, patch }],
    };
  }

  const arrayMatch = ARRAY_SECTION.exec(operation.fieldPath);
  if (arrayMatch) {
    const [, section, indexText, field] = arrayMatch;
    const index = Number(indexText);
    const items = sectionItems(context.content, section);
    const item = items[index];

    if (operation.operation === "insert_section" && field === undefined) {
      // 旧语义：确保数组至少有 index+1 项。新契约要求显式身份与锚点，
      // 这里只在「正好追加到末尾」时映射，其余情况视为过期。
      if (index !== items.length) return stale("旧版插入位置已失效，请重新生成");
      const anchor = index === 0 ? null : (itemIdAt(context.content, section, index - 1) ?? null);
      if (index > 0 && anchor === null) return stale();
      const newId = context.newItemId();
      return {
        ok: true,
        operations: [
          {
            id: operation.id,
            kind: "insert_item",
            section: section as never,
            itemId: newId,
            afterItemId: anchor,
            expectedOrderHash: hashTargetValue(
              items
                .map((entry) => (typeof entry.id === "string" ? entry.id : null))
                .filter((id): id is string => id !== null),
            ),
            value: (operation.replacementValue ?? {}) as Record<string, unknown>,
          },
        ],
      };
    }

    const itemId = itemIdAt(context.content, section, index);
    if (!itemId || !item) return stale();

    if (field === undefined) {
      // 整条替换：拆成对每个已知字段的 set_field，避免用下标定位。
      const next = (operation.replacementValue ?? {}) as Record<string, unknown>;
      const ops: SemanticOperation[] = [];
      for (const [key, fieldValue] of Object.entries(next)) {
        if (key === "id") continue;
        ops.push({
          id: `${operation.id}:${key}`,
          kind: "set_field",
          target: { section: section as never, itemId, field: key } as Target,
          condition: { expectedValueHash: hashTargetValue(item[key]) },
          value: fieldValue,
        });
      }
      if (ops.length === 0) return stale();
      return { ok: true, operations: ops };
    }

    return {
      ok: true,
      operations: [
        {
          id: operation.id,
          kind: "set_field",
          target: { section: section as never, itemId, field } as Target,
          condition: { expectedValueHash: hashTargetValue(item[field]) },
          value,
        },
      ],
    };
  }

  const singletonMatch = SINGLETON_FIELD.exec(operation.fieldPath);
  if (singletonMatch) {
    const [, section, field] = singletonMatch;
    if (section === "basics") {
      const basicsField = field ?? "summary";
      return {
        ok: true,
        operations: [
          {
            id: operation.id,
            kind: "set_field",
            target: { section: "basics", field: basicsField } as Target,
            condition: {
              expectedValueHash: hashTargetValue(
                (context.content.basics as unknown as Record<string, unknown>)[basicsField],
              ),
            },
            value: String(value ?? ""),
          },
        ],
      };
    }
    return {
      ok: true,
      operations: [
        {
          id: operation.id,
          kind: "set_field",
          target: { section: section as never, field: "content" } as Target,
          condition: {
            expectedValueHash: hashTargetValue(
              (context.content as unknown as Record<string, unknown>)[section],
            ),
          },
          value,
        },
      ],
    };
  }

  return { ok: false, reason: "unsupported", message: "这种旧操作无法安全迁移，请重新生成" };
}

/**
 * 批量映射。任何一条失败就整体失败 —— 半套旧提案比不执行更危险。
 */
export function mapLegacyOperations(
  operations: ResumeOperation[],
  context: LegacyMappingContext,
): LegacyMappingResult {
  const mapped: SemanticOperation[] = [];
  for (const operation of operations) {
    const result = mapLegacyOperation(operation, context);
    if (!result.ok) return result;
    mapped.push(...result.operations);
  }
  if (mapped.length === 0) {
    return { ok: false, reason: "unsupported", message: "没有可安全迁移的操作，请重新生成" };
  }
  return { ok: true, operations: mapped };
}

/**
 * 历史记录里的旧提案能否安全重放？
 *
 * 「内容已更新，请重新生成」以外的任何情况都不得直接执行。
 */
export function isLegacyProposalReplayable(
  operations: ResumeOperation[],
  context: LegacyMappingContext,
): boolean {
  return mapLegacyOperations(operations, context).ok;
}

/** 供 UI 展示用：把旧 fieldPath 转成人类可读定位（不做 ID 推断）。 */
export function describeLegacyTarget(fieldPath: string): string {
  const match = ARRAY_SECTION.exec(fieldPath);
  if (match) {
    const [, section, indexText, field] = match;
    const position = `第 ${Number(indexText) + 1} 条`;
    return field ? `${section} ${position} · ${field}` : `${section} ${position}`;
  }
  return fieldPath;
}
