import type { ResumeContent, SemanticOperation, Target } from "@intro-builder/shared/schemas";
import { hashTargetValue } from "@intro-builder/shared/schemas";

import { findItemIndexById } from "./identity";

/**
 * 纯应用器：`prepare` 阶段。
 *
 * 职责边界（这是 F03/F04 的修复核心）：
 * - **只计算**，不写库。持久化由 P02 的单条 CTE 完成。
 * - **不信任模型给的 before/after**。`before` 一律从服务端当前内容读取后哈希；
 *   提示词里的 `beforePlainText` 只是展示材料。
 * - 条件不满足时返回 `conflict`，绝不是「尽力而为地写进去」。提案生成后用户
 *   重排了 A/B，就必须失败，绝不能把 A 的建议写进 B。
 *
 * 返回值里的 `inverse` 是条件撤销的依据：只有当前目标仍等于本次 `after` 时才
 * 允许反向执行（见 P06「撤销后有无关手工编辑，只撤销原目标」）。
 */

/** 变更前的真实值，用于 version 快照与 diff。 */
export type ChangeRecord = {
  operationId: string;
  kind: SemanticOperation["kind"];
  targets: Target[];
  before: unknown;
  after: unknown;
};

export type PrepareFailure = {
  ok: false;
  code:
    | "revision_mismatch"
    | "target_not_found"
    | "condition_mismatch"
    | "invalid_operation"
    | "order_mismatch"
    | "unsupported";
  message: string;
  /** 冲突涉及的目标，供 UI 高亮定位。 */
  targets: Target[];
};

/**
 * resume **行**上的变更。
 *
 * `title` 与 `templateId` 是 resume 表的列，不是 `content` 里的字段。把它们伪装成
 * content 字段会让「先换模板、正文没换」这类半应用状态无法被发现（P03 的失败用例），
 * 所以这里单独返回，由提交层在**同一条 SQL** 里更新行。
 */
export type ResumeRowPatch = {
  title?: string;
  templateId?: string;
  resetStyle?: boolean;
};

export type PrepareSuccess = {
  ok: true;
  changed: boolean;
  nextContent: ResumeContent;
  /** 行的列变更；无则为空对象。 */
  rowPatch: ResumeRowPatch;
  /** 真实前后值，按操作顺序排列。 */
  changes: ChangeRecord[];
  changedTargets: Target[];
  /** 反向操作，用于条件撤销。`changed=false` 时为空。 */
  inverse: SemanticOperation[];
  /** 按有向依赖排序后的操作顺序，供回执记录 operationIds。 */
  orderedOperationIds: string[];
};

export type PrepareResult = PrepareSuccess | PrepareFailure;

export type PrepareInput = {
  content: ResumeContent;
  currentRevision: number;
  expectedRevision: number;
  operations: SemanticOperation[];
  /** 生成新 ID 的能力由调用方注入，保证与创建方同源。 */
  newItemId: () => string;
  /**
   * 行的列（title / templateId）。属于 resume 表而非 content，
   * 因此不由 `content` 读取，避免把行级字段伪装成内容字段。
   */
  resumeRow: { title?: string; templateId?: string };
};

function fail(
  code: PrepareFailure["code"],
  message: string,
  targets: Target[] = [],
): PrepareFailure {
  return { ok: false, code, message, targets };
}

function sectionItems(content: ResumeContent, section: string): Array<Record<string, unknown>> {
  const raw = (content as unknown as Record<string, unknown>)[section];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function readTargetValue(
  content: ResumeContent,
  target: Target,
): { found: boolean; value: unknown } {
  const { section, itemId, field } = target;
  if (itemId === undefined) {
    const raw = (content as unknown as Record<string, unknown>)[section];
    if (raw === undefined) return { found: false, value: undefined };
    if (field === undefined) return { found: true, value: raw };
    return { found: true, value: (raw as Record<string, unknown>)[field] };
  }
  const items = sectionItems(content, section);
  const index = findItemIndexById(content, section as never, itemId);
  if (index < 0) return { found: false, value: undefined };
  const item = items[index];
  if (field === undefined) return { found: true, value: item };
  return { found: true, value: item[field] };
}

function targetLabel(target: Target): string {
  return target.field ? `${target.section}.${target.field}` : target.section;
}

/** 条目 ID 顺序哈希，用于排序前置条件。 */
function orderHash(ids: string[]): string {
  return hashTargetValue(ids);
}

/**
 * 把一组操作按有向依赖排序：插入必须先于「更新新条目」，删除必须先于重排。
 * 依赖关系按下标稳定排序，保证同一份输入总是产生相同的执行顺序（幂等重试一致）。
 */
export function orderOperations(operations: SemanticOperation[]): SemanticOperation[] {
  const priority: Record<SemanticOperation["kind"], number> = {
    insert_item: 0,
    set_field: 1,
    delete_item: 2,
    reorder_items: 3,
    set_section_order: 4,
    set_style: 5,
    set_title: 6,
    set_template: 7,
  };
  return operations
    .map((op, index) => ({ op, index }))
    .sort((a, b) => {
      const byPriority = priority[a.op.kind] - priority[b.op.kind];
      return byPriority !== 0 ? byPriority : a.index - b.index;
    })
    .map((entry) => entry.op);
}

export function prepareMutation(input: PrepareInput): PrepareResult {
  const { content, currentRevision, expectedRevision, operations } = input;

  if (currentRevision !== expectedRevision) {
    return fail(
      "revision_mismatch",
      `文档已更新到修订 ${currentRevision}，你的提案基于修订 ${expectedRevision}`,
    );
  }

  if (operations.length === 0) {
    return fail("invalid_operation", "提交必须至少包含一个操作");
  }

  const ordered = orderOperations(operations);
  const changes: ChangeRecord[] = [];
  const inverse: SemanticOperation[] = [];
  const changedTargets: Target[] = [];
  const rowPatch: ResumeRowPatch = {};
  let nextContent = content;
  let changed = false;
  /** 行级字段的「当前值」累积视图：同一命令里两次 set_title 必须看到前一次结果。 */
  const rowView = { ...input.resumeRow };

  for (const op of ordered) {
    const applied = applyOne(nextContent, op, input.newItemId, rowView);
    if (!applied.ok) return applied.failure;
    if (!applied.applied) continue;

    nextContent = applied.content;
    if (applied.rowPatch) Object.assign(rowPatch, applied.rowPatch);
    changed = true;
    changes.push({
      operationId: op.id,
      kind: op.kind,
      targets: applied.targets,
      before: applied.before,
      after: applied.after,
    });
    changedTargets.push(...applied.targets);
    if (applied.inverse) inverse.push(applied.inverse);
  }

  return {
    ok: true,
    changed,
    nextContent,
    rowPatch,
    changes,
    changedTargets,
    inverse: changed ? inverse : [],
    orderedOperationIds: ordered.map((op) => op.id),
  };
}

type ApplyOneResult =
  | { ok: true; applied: false }
  | {
      ok: true;
      applied: true;
      content: ResumeContent;
      targets: Target[];
      before: unknown;
      after: unknown;
      inverse: SemanticOperation | null;
      rowPatch?: ResumeRowPatch;
    }
  | { ok: false; failure: PrepareFailure };

const NOT_APPLIED: ApplyOneResult = { ok: true, applied: false };

function applyOne(
  content: ResumeContent,
  op: SemanticOperation,
  newItemId: () => string,
  rowView: { title?: string; templateId?: string },
): ApplyOneResult {
  switch (op.kind) {
    case "set_field":
      return applySetField(content, op);
    case "insert_item":
      return applyInsertItem(content, op, newItemId);
    case "delete_item":
      return applyDeleteItem(content, op);
    case "reorder_items":
      return applyReorderItems(content, op);
    case "set_section_order":
      return applySetSectionOrder(content, op);
    case "set_style":
      return applySetStyle(content, op);
    case "set_title":
      return applySetTitle(content, op, rowView);
    case "set_template":
      return applySetTemplate(content, op, rowView);
    default:
      return { ok: false, failure: fail("unsupported", "未知操作类型") };
  }
}

/**
 * 按动态 section 名写回条目数组。
 *
 * 与 identity.ts 中的同名字段索引是同一类问题：`ResumeContent` 各区块字段类型不同，
 * 变量名索引必然需要一次转换。刻意**不做** `ResumeContent.parse`：
 * prepare 的职责是纯计算，容器的类型约束已由命令 schema 与字段白名单保证，
 * 真正的契约校验放在提交层（P02）落库前的那一次。
 */
function withSectionItems(
  content: ResumeContent,
  section: string,
  items: Array<Record<string, unknown>>,
): ResumeContent {
  return { ...(content as unknown as Record<string, unknown>), [section]: items } as ResumeContent;
}

function applySetField(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "set_field" }>,
): ApplyOneResult {
  const { target } = op;
  const current = readTargetValue(content, target);

  // 目标不存在时明确失败。绝不「创建到最近似的下标」——那正是把 A 的建议写进 B 的路径。
  if (!current.found) {
    return {
      ok: false,
      failure: fail("target_not_found", `找不到目标：${targetLabel(target)}`, [target]),
    };
  }

  const actualHash = hashTargetValue(current.value);
  if (actualHash !== op.condition.expectedValueHash) {
    return {
      ok: false,
      failure: fail(
        "condition_mismatch",
        `${targetLabel(target)} 的内容已变化，提案可能已过期`,
        [target],
      ),
    };
  }

  if (JSON.stringify(current.value) === JSON.stringify(op.value)) {
    return NOT_APPLIED;
  }

  const before = current.value;
  const after = op.value;

  if (target.itemId === undefined && target.field !== undefined) {
    const next = { ...(content as unknown as Record<string, unknown>) };
    if (target.section === "basics") {
      next.basics = { ...(content.basics as object), [target.field]: after };
    } else {
      next[target.section] = after;
    }
    return {
      ok: true,
      applied: true,
      content: next as ResumeContent,
      targets: [target],
      before,
      after,
      inverse: {
        id: `${op.id}:inverse`,
        kind: "set_field",
        target,
        condition: { expectedValueHash: hashTargetValue(after) },
        value: before,
      },
    };
  }

  if (target.itemId === undefined && target.field === undefined) {
    // 整块替换（例如 basics 一次给多个字段）。只合并白名单字段。
    const patch = (after ?? {}) as Record<string, unknown>;
    const next = { ...(content as unknown as Record<string, unknown>) };
    next[target.section] = { ...(current.value as Record<string, unknown>), ...patch };
    return {
      ok: true,
      applied: true,
      content: next as ResumeContent,
      targets: [target],
      before,
      after: next[target.section],
      inverse: {
        id: `${op.id}:inverse`,
        kind: "set_field",
        target,
        condition: { expectedValueHash: hashTargetValue(next[target.section]) },
        value: before,
      },
    };
  }

  const items = sectionItems(content, target.section);
  const index = findItemIndexById(content, target.section as never, target.itemId as string);
  if (index < 0) {
    return {
      ok: false,
      failure: fail("target_not_found", `找不到条目 ${target.itemId}`, [target]),
    };
  }
  const nextItems = [...items];
  nextItems[index] = { ...items[index], [target.field as string]: after };

  return {
    ok: true,
    applied: true,
    content: withSectionItems(content, target.section, nextItems),
    targets: [target],
    before,
    after,
    inverse: {
      id: `${op.id}:inverse`,
      kind: "set_field",
      target,
      condition: { expectedValueHash: hashTargetValue(after) },
      value: before,
    },
  };
}

function applyInsertItem(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "insert_item" }>,
  newItemId: () => string,
): ApplyOneResult {
  const items = sectionItems(content, op.section);
  const ids = items
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => id !== null);

  // 排序条件：该操作执行前，本区块的条目 ID 顺序必须与提案一致，
  // 否则 afterItemId 已失去意义（期间有人增删）。
  // 注意：同一批次内多条插入时，adapter 必须为每条算出「执行前」的顺序
  // （见 editor-adapter 的 orderSimulation），而不是复用同一份快照。
  if (orderHash(ids) !== op.expectedOrderHash) {
    return {
      ok: false,
      failure: fail(
        "order_mismatch",
        `${op.section} 的条目已发生变化，插入位置不再可靠`,
        [{ section: op.section as never, itemId: op.afterItemId ?? undefined }],
      ),
    };
  }

  if (items.some((item) => item.id === op.itemId)) {
    return {
      ok: false,
      failure: fail("invalid_operation", `条目 ID ${op.itemId} 已存在`, [
        { section: op.section as never, itemId: op.itemId },
      ]),
    };
  }

  // itemId 与相邻锚点由命令给出；`newItemId` 仅用于补齐调用方未提供的场景。
  const itemId = op.itemId || newItemId();
  const item = { ...op.value, id: itemId };

  let insertAt: number;
  if (op.afterItemId === null) {
    insertAt = 0;
  } else {
    const anchor = items.findIndex((existing) => existing.id === op.afterItemId);
    if (anchor < 0) {
      return {
        ok: false,
        failure: fail("order_mismatch", `找不到相邻条目 ${op.afterItemId}`, [
          { section: op.section as never, itemId: op.afterItemId ?? undefined },
        ]),
      };
    }
    insertAt = anchor + 1;
  }

  const nextItems = [...items.slice(0, insertAt), item, ...items.slice(insertAt)];
  return {
    ok: true,
    applied: true,
    content: withSectionItems(content, op.section, nextItems),
    targets: [{ section: op.section as never, itemId }],
    before: null,
    after: item,
    inverse: {
      id: `${op.id}:inverse`,
      kind: "delete_item",
      target: { section: op.section as never, itemId },
      condition: { expectedValueHash: hashTargetValue(item) },
    },
  };
}

function applyDeleteItem(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "delete_item" }>,
): ApplyOneResult {
  const { target } = op;
  if (target.itemId === undefined) {
    return {
      ok: false,
      failure: fail("invalid_operation", "删除必须指定条目 ID", [target]),
    };
  }
  const items = sectionItems(content, target.section);
  const index = findItemIndexById(content, target.section as never, target.itemId);
  if (index < 0) {
    return { ok: false, failure: fail("target_not_found", `找不到条目 ${target.itemId}`, [target]) };
  }

  // 删除是破坏性的：必须确认整条内容仍与提案生成时一致，否则用户删的是别的东西。
  const currentItem = items[index];
  if (hashTargetValue(currentItem) !== op.condition.expectedValueHash) {
    return {
      ok: false,
      failure: fail("condition_mismatch", `条目 ${target.itemId} 已被修改，删除已取消`, [target]),
    };
  }

  const nextItems = [...items.slice(0, index), ...items.slice(index + 1)];
  let inverse: SemanticOperation | null = null;
  if (index > 0) {
    const previous = items[index - 1];
    const previousId = typeof previous.id === "string" ? previous.id : null;
    if (previousId) {
      inverse = {
        id: `${op.id}:inverse`,
        kind: "insert_item",
        section: op.target.section as never,
        itemId: target.itemId,
        afterItemId: previousId,
        expectedOrderHash: orderHash(
          nextItems
            .map((item) => (typeof item.id === "string" ? item.id : null))
            .filter((id): id is string => id !== null),
        ),
        value: currentItem,
      };
    }
  }
  if (!inverse) {
    // 删的是第一条：反向插入到最前。
    inverse = {
      id: `${op.id}:inverse`,
      kind: "insert_item",
      section: op.target.section as never,
      itemId: target.itemId,
      afterItemId: null,
      expectedOrderHash: orderHash(
        nextItems
          .map((item) => (typeof item.id === "string" ? item.id : null))
          .filter((id): id is string => id !== null),
      ),
      value: currentItem,
    };
  }

  return {
    ok: true,
    applied: true,
    content: withSectionItems(content, target.section, nextItems),
    targets: [target],
    before: currentItem,
    after: null,
    inverse,
  };
}

function applyReorderItems(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "reorder_items" }>,
): ApplyOneResult {
  const items = sectionItems(content, op.section);
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (typeof item.id === "string") byId.set(item.id, item);
  }

  /*
   * 前置条件必须比对**顺序**，不能只比对集合。
   *
   * 只比集合会漏掉「期间有人重排过」：集合相同、顺序不同时集合比较通过，
   * 于是本操作会用自己的 afterIds 覆盖对方刚做的排序 —— 一次静默的丢失更新，
   * 而且丢的正是这次要改的那个字段。`applySetSectionOrder` 一直比对顺序，
   * 这里此前不一致，属于实现疏漏。
   */
  const currentIds = items
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => id !== null);

  // 重排的顺序条件：该操作执行前，本区块的**全量** ID 顺序必须与提案一致。
  // 同一批次里若前面已有插入，adapter 必须把插入后的顺序作为 beforeIds。
  if (
    currentIds.length !== op.beforeIds.length ||
    op.beforeIds.some((id, i) => id !== currentIds[i])
  ) {
    return {
      ok: false,
      failure: fail(
        "order_mismatch",
        `${op.section} 的条目顺序已变化（或条目被增删），无法按其原始顺序重排`,
      ),
    };
  }

  if (op.beforeIds.every((id, i) => id === op.afterIds[i])) {
    return NOT_APPLIED;
  }

  const nextItems = op.afterIds.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`reorder 缺少条目 ${id}`);
    return item;
  });

  return {
    ok: true,
    applied: true,
    content: withSectionItems(content, op.section, nextItems),
    targets: [],
    before: currentIds,
    after: op.afterIds,
    inverse: {
      id: `${op.id}:inverse`,
      kind: "reorder_items",
      section: op.section,
      beforeIds: op.afterIds,
      afterIds: op.beforeIds,
    },
  };
}

function applySetSectionOrder(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "set_section_order" }>,
): ApplyOneResult {
  if (
    content.sectionOrder.length !== op.before.length ||
    content.sectionOrder.some((key, i) => key !== op.before[i])
  ) {
    return {
      ok: false,
      failure: fail("condition_mismatch", "模块顺序已变化，提案已过期"),
    };
  }
  if (op.before.every((key, i) => key === op.after[i])) return NOT_APPLIED;

  return {
    ok: true,
    applied: true,
    content: { ...content, sectionOrder: op.after },
    targets: [],
    before: op.before,
    after: op.after,
    inverse: {
      id: `${op.id}:inverse`,
      kind: "set_section_order",
      before: op.after,
      after: op.before,
    },
  };
}

function applySetStyle(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "set_style" }>,
): ApplyOneResult {
  const current = content.styleSettings ?? {};
  /*
   * 条件校验必须覆盖 patch 里的**每一个**键，而不是只遍历 `before` 给出的键。
   *
   * 只遍历 `before` 时，`before: {}`（空对象）会让整个校验被跳过 ——
   * 实测：服务端已是 `fontSize: 11`，`before: {}` 的 patch 直接接受并写成 15，
   * 一次静默丢失更新。空 before 不是「无需校验」，而是「没有提供任何前置条件」，
   * 对这种输入应当逐键与当前值比对：不一致即冲突。
   */
  for (const key of Object.keys(op.patch)) {
    if (!(key in op.before)) {
      /*
       * 未给出该键的前置值时，以「当前是否存在该键」为判据：
       * 当前已有值 → 冲突（不能在没有前置条件的情况下覆盖）；
       * 当前也没有 → 视为新增，允许。
       */
      const currentValue = (current as Record<string, unknown>)[key];
      if (currentValue !== undefined) {
        return {
          ok: false,
          failure: fail(
            "condition_mismatch",
            `样式 ${key} 已被设置，但提案未提供其前置值，无法确认基于当前内容`,
          ),
        };
      }
    }
  }
  for (const [key, value] of Object.entries(op.before)) {
    const currentValue = (current as Record<string, unknown>)[key];
    // 两边都不存在 → 视为一致（该样式项在前后都未被设置）。
    if (currentValue === undefined && value === undefined) continue;
    if (currentValue !== value) {
      return {
        ok: false,
        failure: fail("condition_mismatch", `样式 ${key} 已被修改，提案已过期`),
      };
    }
  }

  const nextStyle = { ...current, ...op.patch } as ResumeContent["styleSettings"];
  if (JSON.stringify(current) === JSON.stringify(nextStyle)) return NOT_APPLIED;

  return {
    ok: true,
    applied: true,
    content: { ...content, styleSettings: nextStyle },
    targets: [],
    before: current,
    after: nextStyle,
    inverse: {
      id: `${op.id}:inverse`,
      kind: "set_style",
      before: op.patch,
      patch: op.before,
    },
  };
}

function applySetTitle(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "set_title" }>,
  rowView: { title?: string },
): ApplyOneResult {
  const currentText = rowView.title ?? "";
  if (op.before !== currentText) {
    return { ok: false, failure: fail("condition_mismatch", "简历标题已被修改，提案已过期") };
  }
  if (op.before === op.after) return NOT_APPLIED;
  rowView.title = op.after;
  return {
    ok: true,
    applied: true,
    content,
    rowPatch: { title: op.after },
    targets: [],
    before: currentText,
    after: op.after,
    inverse: { id: `${op.id}:inverse`, kind: "set_title", before: op.after, after: op.before },
  };
}

function applySetTemplate(
  content: ResumeContent,
  op: Extract<SemanticOperation, { kind: "set_template" }>,
  rowView: { templateId?: string },
): ApplyOneResult {
  const currentId = rowView.templateId ?? "";
  if (op.before !== currentId) {
    return { ok: false, failure: fail("condition_mismatch", "模板已被修改，提案已过期") };
  }
  if (op.before === op.after) return NOT_APPLIED;
  rowView.templateId = op.after;
  return {
    ok: true,
    applied: true,
    content,
    rowPatch: { templateId: op.after, resetStyle: op.resetStyle },
    targets: [],
    before: currentId,
    after: op.after,
    inverse: {
      id: `${op.id}:inverse`,
      kind: "set_template",
      before: op.after,
      after: op.before,
      resetStyle: op.resetStyle,
    },
  };
}
