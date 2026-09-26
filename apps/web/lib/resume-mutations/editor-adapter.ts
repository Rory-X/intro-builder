import type { ResumeContent, SemanticOperation, Target } from "@intro-builder/shared/schemas";
import { ARRAY_SECTION_KEYS, hashTargetValue } from "@intro-builder/shared/schemas";

/**
 * 编辑器适配器：把「当前表单内容」翻译成「语义命令」。
 *
 * 这是 P03 的核心缺口。提交模块（P02）只接受 `SemanticOperation[]`，而编辑器持有的是
 * 一整份 RHF 表单内容。中间必须有人做这件事，而且必须做对：
 *
 * 1. **条件哈希来自 baseline**（服务端已确认的内容），不是来自当前表单。
 *    否则「提案基于哪一版」就消失了，冲突检测形同虚设。
 * 2. **按稳定 ID 对齐条目**，按下标只用于「发现」变化，绝不用于表达目标。
 * 3. **只产出真正变化的操作**。没有变化就返回空数组 —— 提交层据此返回 `no_change`，
 *    不会生成空修订。
 *
 * 新增条目的 ID 由**编辑器**在 append 时生成（`item-id.ts` 的 `withItemId`），
 * 适配器只负责识别「这个 ID 在 baseline 里没有 → 是一次插入」。适配器**不**生成身份：
 * 身份必须在条目进入表单的那一刻就固定，否则重试会算出新 ID。
 * 4. 条目缺 ID 时**拒绝**（返回 `needs_identity`），不回退到下标。这是 F03 的防线：
 *    宁可要求调用方先做身份初始化，也不猜身份。
 */

export type EditorDiffFailure = {
  ok: false;
  reason: "needs_identity" | "unsupported_structure";
  message: string;
};

export type EditorDiffSuccess = {
  ok: true;
  operations: SemanticOperation[];
  /** 变化涉及的区块，供 UI 高亮与日志（不含正文）。 */
  changedSections: string[];
};

export type EditorDiffResult = EditorDiffSuccess | EditorDiffFailure;

export type EditorDiffInput = {
  /** 服务端已确认的内容（含 revision 对应的真实值）。 */
  baseline: ResumeContent;
  /** 当前表单内容。 */
  next: ResumeContent;
  /** 生成操作 ID 的能力；由调用方注入以便测试稳定。 */
  newOpId: () => string;
  /** resume 行的 title / templateId（不属于 content）。 */
  baselineRow?: { title?: string; templateId?: string };
  nextRow?: { title?: string; templateId?: string };
  /**
   * 换模板时要一并应用的排版（模板的 `defaultStyleSettings`）。
   *
   * 由调用方提供，因为只有它知道模板注册表（本模块是纯函数，不依赖服务端资源）。
   * 给出时会产生一条 `set_style` 操作 —— 排版属于 **content**，
   * 而 `set_template` 只负责行上的 templateId。分层保持清晰：
   * 行级变更走 rowPatch，内容级变更走语义操作。
   */
  templateStyleReset?: { templateId: string; style: Record<string, unknown> } | null;
};

const ARRAY_SECTIONS = ARRAY_SECTION_KEYS;

/**
 * 值是否真的不同。用规范化 JSON 比较，避免对象引用差异造成假变更。
 *
 * 必须防御 `undefined`：`hashValue(undefined)` 会抛
 * `Cannot read properties of undefined (reading 'length')`（实测）。
 * 编译器在 `noUncheckedIndexedAccess` 未开启时不会拦下 `obj[key]` 的 undefined，
 * 所以这里必须在运行时兜住 —— 否则一次缺字段的输入就能让整个保存流程崩掉。
 */
function differs(a: unknown, b: unknown): boolean {
  if (a === undefined && b === undefined) return false;
  if (a === undefined || b === undefined) return true;
  return hashTargetValue(a) !== hashTargetValue(b);
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function itemsOf(content: ResumeContent, section: string): Array<Record<string, unknown>> {
  const raw = (content as unknown as Record<string, unknown>)[section];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function itemIdOf(item: Record<string, unknown> | undefined): string | null {
  const id = item?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * 单例区块的字段表。刻意与契约 `SECTION_FIELDS` 保持一致：
 * 这里只负责「哪些字段要比较」，合法性由命令 schema 在提交时再次校验。
 */
const SINGLETON_TIPTAP_FIELDS = ["skills", "summary", "awards", "portfolio"] as const;
const BASICS_TEXT_FIELDS = [
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
const ARRAY_TEXT_FIELDS: Record<string, readonly string[]> = {
  experience: ["company", "title", "start", "end", "location"],
  projects: ["name", "role", "location", "start", "end", "stack", "link"],
  education: ["school", "degree", "major", "location", "start", "end", "gpa"],
  research: ["name", "role", "location", "start", "end", "paperTitle", "link"],
  custom: ["title"],
};
const ARRAY_TIPTAP_FIELD: Record<string, string> = {
  experience: "content",
  projects: "content",
  education: "highlights",
  research: "content",
  custom: "content",
};

export function buildMutationOperations(input: EditorDiffInput): EditorDiffResult {
  const { baseline, next, newOpId } = input;
  const operations: SemanticOperation[] = [];
  const changedSections = new Set<string>();

  // ─── 1. basics（单例对象，逐字段） ───────────────────────
  for (const field of BASICS_TEXT_FIELDS) {
    const before = (baseline.basics as unknown as Record<string, unknown>)[field];
    const after = (next.basics as unknown as Record<string, unknown>)[field];
    if (!differs(before, after)) continue;
    operations.push({
      id: newOpId(),
      kind: "set_field",
      target: { section: "basics", field } as Target,
      condition: { expectedValueHash: hashTargetValue(before) },
      value: after,
    });
    changedSections.add("basics");
  }

  // ─── 2. 单例 TipTap 区块 ─────────────────────────────────
  /*
   * 单例区块的定位是 `section` 本身（不带 field）。
   *
   * 契约里 `summary`/`skills`/`awards`/`portfolio` 的**值就是 TipTap doc**，
   * 所以目标是整个区块。此前写成 `field: "content"`，于是 prepare 会去读
   * doc 内层的 `content` 数组，而这里哈希的是整个 doc —— 两者永不相等，
   * 这四个模块的编辑**永远**以 condition_mismatch 失败（实测四个区块全废）。
   *
   * 契约的 `SECTION_FIELDS` 里这几个区块的字段名 `content` 指的是
   * 「该区块承载内容」的语义标记，不是「doc 里的 content 键」。
   */
  for (const field of SINGLETON_TIPTAP_FIELDS) {
    const before = baseline[field];
    const after = next[field];
    if (!differs(before, after)) continue;
    operations.push({
      id: newOpId(),
      kind: "set_field",
      target: { section: field } as Target,
      condition: { expectedValueHash: hashTargetValue(before) },
      value: after,
    });
    changedSections.add(field);
  }

  // ─── 3. 数组区块：按稳定 ID 对齐 ─────────────────────────
  for (const section of ARRAY_SECTIONS) {
    const beforeItems = itemsOf(baseline, section);
    const afterItems = itemsOf(next, section);

    // 缺 ID 就拒绝：绝不按下标猜身份。
    const missingInBaseline = beforeItems.some((item) => itemIdOf(item) === null);
    const missingInNext = afterItems.some((item) => itemIdOf(item) === null);
    if ((beforeItems.length > 0 && missingInBaseline) || (afterItems.length > 0 && missingInNext)) {
      return {
        ok: false,
        reason: "needs_identity",
        message: `${section} 的条目缺少稳定身份，请刷新页面后重试`,
      };
    }

    const beforeById = new Map<string, Record<string, unknown>>();
    for (const item of beforeItems) beforeById.set(itemIdOf(item) as string, item);
    const afterById = new Map<string, Record<string, unknown>>();
    for (const item of afterItems) afterById.set(itemIdOf(item) as string, item);

    const beforeIds = beforeItems.map((item) => itemIdOf(item) as string);
    const afterIds = afterItems.map((item) => itemIdOf(item) as string);

    // 复制出的重复 ID 无法定位 —— 明确失败，而不是挑一个。
    if (new Set(afterIds).size !== afterIds.length) {
      return {
        ok: false,
        reason: "unsupported_structure",
        message: `${section} 出现重复的条目身份，请刷新页面后重试`,
      };
    }

    // 3a. 删除
    for (const id of beforeIds) {
      if (afterById.has(id)) continue;
      const item = beforeById.get(id) as Record<string, unknown>;
      operations.push({
        id: newOpId(),
        kind: "delete_item",
        target: { section, itemId: id } as Target,
        // 删除是破坏性的：整条内容作为前置条件，确保删的就是当时那条。
        condition: { expectedValueHash: hashTargetValue(item) },
      });
      changedSections.add(section);
    }

    /*
     * 3b. 插入（按「出现在哪个已有锚点之后」表达）。
     *
     * `orderSimulation` 是**顺序推演**：每条操作的条件必须是「执行到它之前」的
     * 顺序，而不是整批共用的 baseline 快照。
     *
     * 为什么必须推演：2 秒去抖窗口内连点两次「+ 添加」会在同一批里产生两条插入。
     * 若两条都用 baseline 顺序作条件，第一条插入后顺序已变，第二条必然
     * `order_mismatch` —— 实测两条都存不进去（真实缺陷）。
     */
    /*
     * 顺序推演的起点 = baseline 的**原始**顺序。
     *
     * 必须与 prepare 里 `orderOperations` 的**真实执行顺序**一致：
     * `insert_item`(0) 先于 `delete_item`(2) 执行，所以插入发生时删除还没发生，
     * 此刻的列表就是原始列表（加上本批次先前已插入的条目）。
     * 若把删除预先扣掉，插入的条件会与执行时的实际列表不符 → order_mismatch
     *（实测「新增 + 删除」因此失败）。
     */
    const deletedIds = new Set(beforeIds.filter((id) => !afterById.has(id)));
    const orderSimulation = [...beforeIds];

    for (let index = 0; index < afterItems.length; index++) {
      const id = afterIds[index];
      if (beforeById.has(id)) continue;

      // 锚点：向前找第一个在执行到此刻时已存在的条目。
      let anchor: string | null = null;
      for (let back = index - 1; back >= 0; back--) {
        const candidate = afterIds[back];
        if (orderSimulation.includes(candidate)) {
          anchor = candidate;
          break;
        }
      }

      operations.push({
        id: newOpId(),
        kind: "insert_item",
        section,
        itemId: id,
        afterItemId: anchor,
        // 条件 = 此刻的顺序（含本批次先前已插入的条目）。
        expectedOrderHash: hashTargetValue([...orderSimulation]),
        value: { ...afterItems[index] },
      });
      changedSections.add(section);

      // 推演：把这条插入反映到顺序里，供后续操作使用。
      const anchorIndex =
        anchor === null ? -1 : orderSimulation.findIndex((existing) => existing === anchor);
      orderSimulation.splice(anchorIndex + 1, 0, id);
    }

    // 3c. 字段更新（只处理两边都存在的条目）
    for (const id of afterIds) {
      const before = beforeById.get(id);
      const after = afterById.get(id);
      if (!before || !after) continue;

      for (const field of ARRAY_TEXT_FIELDS[section] ?? []) {
        if (!differs(before[field], after[field])) continue;
        operations.push({
          id: newOpId(),
          kind: "set_field",
          target: { section, itemId: id, field } as Target,
          condition: { expectedValueHash: hashTargetValue(before[field] ?? "") },
          value: after[field],
        });
        changedSections.add(section);
      }

      const tiptapField = ARRAY_TIPTAP_FIELD[section];
      if (tiptapField && differs(before[tiptapField], after[tiptapField])) {
        operations.push({
          id: newOpId(),
          kind: "set_field",
          target: { section, itemId: id, field: tiptapField } as Target,
          condition: { expectedValueHash: hashTargetValue(before[tiptapField]) },
          value: after[tiptapField],
        });
        changedSections.add(section);
      }
    }

    /*
     * 3d. 重排：条件与目标都用**推演后**的顺序。
     *
     * `orderSimulation`（已含本批次插入的条目）是 prepare 会看到的当前顺序；
     * 直接在它上面算目标顺序，从而同时覆盖「仅重排」与「新增 + 重排」两种情形。
     * 此前用「幸存者集合」两侧比对，而 prepare 比对的是全量列表，
     * 导致新增 + 重排必然 order_mismatch（实测）。
     */
    /*
     * 重排的执行时机在插入与删除**之后**（优先级 3 > 0 与 2），
     * 因此它的顺序快照必须扣掉本批次已删除的条目。
     */
    const reorderSimulation = orderSimulation.filter((id) => !deletedIds.has(id));

    if (reorderSimulation.length > 0) {
      const afterIndexById = new Map(afterIds.map((id, index) => [id, index]));
      const reordered = [...reorderSimulation].sort((a, b) => {
        const ai = afterIndexById.get(a);
        const bi = afterIndexById.get(b);
        // 不在 afterIds 里的条目（理论上不会有：插入已推演进 simulation）排在最后。
        if (ai === undefined && bi === undefined) return 0;
        if (ai === undefined) return 1;
        if (bi === undefined) return -1;
        return ai - bi;
      });
      if (reordered.some((id, i) => id !== reorderSimulation[i])) {
        operations.push({
          id: newOpId(),
          kind: "reorder_items",
          section,
          beforeIds: [...reorderSimulation],
          afterIds: reordered,
        });
        changedSections.add(section);
      }
    }
  }

  // ─── 4. sectionOrder ────────────────────────────────────
  if (differs(baseline.sectionOrder, next.sectionOrder)) {
    operations.push({
      id: newOpId(),
      kind: "set_section_order",
      before: [...baseline.sectionOrder],
      after: [...next.sectionOrder],
    });
    changedSections.add("sectionOrder");
  }

  // ─── 5. 样式 ────────────────────────────────────────────
  /*
   * 样式区块：`styleSettings` 在新建简历里**不存在**（`emptyResumeContent()` 不含它）。
   *
   * 因此 `beforeStyle[key]` 可能是 `undefined`，而 `hashValue(undefined)` 会崩
   * （`canonicalize` 返回 undefined → 读 `.length` 抛错，实测确认）。崩溃点在
   * 会话 hook 内**不在 try/catch 里**，会让状态永久卡在 pending，
   * 之后连正文也存不上 —— 一次样式改动毒化整份文档。
   *
   * `differs` 需要能处理 undefined：用「存在性 + 值」两层判断，而不是直接哈希，
   * 也不能把 undefined 塞进哈希。
   */
  const beforeStyle = asRecord(baseline.styleSettings);
  const afterStyle = asRecord(next.styleSettings);
  const stylePatch: Record<string, unknown> = {};
  const styleBefore: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(beforeStyle), ...Object.keys(afterStyle)])) {
    const hasBefore = key in beforeStyle;
    const hasAfter = key in afterStyle;
    // 两边都没有 → 不可能（key 来自两者的并集）。
    if (!hasBefore && !hasAfter) continue;
    // 一边有、一边没有 → 视为变化（新增或删除该样式项）。
    // 注意：即使 before 侧不存在，也必须把该键写进 before（值为 undefined），
    // 否则 prepare 会因为「patch 里有键但 before 没给」而拒绝整条提案。
    if (hasBefore !== hasAfter) {
      stylePatch[key] = afterStyle[key];
      styleBefore[key] = beforeStyle[key];
      continue;
    }
    if (!differs(beforeStyle[key], afterStyle[key])) continue;
    stylePatch[key] = afterStyle[key];
    styleBefore[key] = beforeStyle[key];
  }
  if (Object.keys(stylePatch).length > 0) {
    operations.push({
      id: newOpId(),
      kind: "set_style",
      before: styleBefore,
      patch: stylePatch,
    });
    changedSections.add("styleSettings");
  }

  // ─── 6. 行级字段（title / templateId） ───────────────────
  const baselineRow = input.baselineRow ?? {};
  const nextRow = input.nextRow ?? {};
  if (nextRow.title !== undefined && nextRow.title !== baselineRow.title) {
    operations.push({
      id: newOpId(),
      kind: "set_title",
      before: baselineRow.title ?? "",
      after: nextRow.title,
    });
    changedSections.add("title");
  }
  if (nextRow.templateId !== undefined && nextRow.templateId !== baselineRow.templateId) {
    /*
     * `resetStyle` 记录「本次换模板是否意图重置排版」。
     *
     * 真正的排版重置**不由这里表达**，而是下面那条 `set_style` 操作 ——
     * 排版存在 content 里，`set_template` 只改行。旧实现在这里硬编码 `false`
     * 且提交层丢弃该字段，导致「换模板心智模型里的排版重置」静默失效
     * （相对旧 `setTemplate` 默认行为的回归）。
     */
    const resetStyle =
      input.templateStyleReset?.templateId === nextRow.templateId &&
      input.templateStyleReset?.style !== undefined;
    operations.push({
      id: newOpId(),
      kind: "set_template",
      before: baselineRow.templateId ?? "",
      after: nextRow.templateId,
      resetStyle,
    });
    changedSections.add("templateId");

    if (resetStyle && input.templateStyleReset) {
      const defaults = input.templateStyleReset.style;
      const currentStyle = asRecord(next.styleSettings);
      const styleBefore: Record<string, unknown> = {};
      const stylePatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(defaults)) {
        styleBefore[key] = currentStyle[key];
        stylePatch[key] = value;
      }
      operations.push({
        id: newOpId(),
        kind: "set_style",
        before: styleBefore,
        patch: stylePatch,
      });
      changedSections.add("styleSettings");
    }
  }

  return { ok: true, operations, changedSections: [...changedSections] };
}


/**
 * 生成「应用某个模板」所需的操作（供模板库使用）。
 *
 * 模板库的应用链路此前直接调用旧 `setTemplate` action：那条路径**不带 revision**、
 * 不写 mutation 留痕，还默认**整体覆盖** `styleSettings`。与编辑器并发时两边互相覆盖，
 * 且事后无法追溯是谁改的（P03 的统一写入只覆盖了编辑器，漏了这条）。
 *
 * 这里复用同一条差量通道：
 * - `baselineRow.templateId → nextRow.templateId` 产出 `set_template`；
 * - 若 `resetStyle`，额外产出一条 `set_style`（模板默认排版来自调用方提供的注册表数据）。
 *
 * 调用方负责提供 `expectedRevision`（从服务端读到的当前值）并走 `submitResumeMutation`。
 */
export function buildApplyTemplateOperations(input: {
  baseline: ResumeContent;
  baselineTemplateId: string;
  nextTemplateId: string;
  /** 该模板的默认排版；给出时视为「换模板并重置排版」。 */
  templateStyle?: Record<string, unknown> | null;
  newOpId: () => string;
}): { ok: true; operations: SemanticOperation[] } {
  const result = buildMutationOperations({
    baseline: input.baseline,
    next: input.baseline,
    newOpId: input.newOpId,
    baselineRow: { templateId: input.baselineTemplateId },
    nextRow: { templateId: input.nextTemplateId },
    templateStyleReset: input.templateStyle
      ? { templateId: input.nextTemplateId, style: input.templateStyle }
      : null,
  });
  if (!result.ok) return { ok: true, operations: [] };
  return { ok: true, operations: result.operations };
}
