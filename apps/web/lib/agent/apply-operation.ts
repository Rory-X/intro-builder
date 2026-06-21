import {
  DEFAULT_STYLE_SETTINGS,
  StyleSettings,
  type ResumeContent,
} from "@intro-builder/shared/schemas";
import type { ResumeOperation } from "@intro-builder/shared/types";

/**
 * Pure mapping from an agent {@link ResumeOperation} to the next resume content.
 *
 * Used when the user accepts a change-set (including create-from-zero drafts):
 * it sets simple/top-level fields, and for array sections it creates any missing
 * items (with schema-default fields) before writing, and makes sure the section
 * is present in `sectionOrder` so it actually renders.
 *
 * Returns `null` when the operation is not auto-applicable, so the caller can
 * surface a "not supported" message instead of corrupting the form.
 */
export type ApplyResumeOperationResult = {
  content: ResumeContent;
  /** Top-level resume keys that changed (for granular RHF `setValue`). */
  changedKeys: string[];
} | null;

type TipTapDoc = { type: "doc"; content: unknown[] };

const ARRAY_SECTION_FIELD =
  /^(experience|projects|education|research|custom)\.(\d+)\.(content|highlights)$/;
const ARRAY_ITEM_FIELD =
  /^(experience|projects|education|research)\.(\d+)\.([A-Za-z][A-Za-z0-9]*)$/;
const ARRAY_ITEM_PATH = /^(experience|projects|education|research)\.(\d+)$/;
const CUSTOM_ITEM_FIELD =
  /^custom\.(\d+|[^.]+)\.(title|content)$/;
const CUSTOM_ITEM_PATH = /^custom\.(\d+|[^.]+)$/;

const TOP_LEVEL_TIPTAP_FIELDS = new Set([
  "skills",
  "summary",
  "awards",
  "portfolio",
]);
const BASICS_FIELDS = new Set([
  "name",
  "status",
  "title",
  "email",
  "phone",
  "location",
  "website",
  "summary",
  "photo",
]);
const ARRAY_METADATA_FIELDS: Record<string, Set<string>> = {
  experience: new Set(["company", "title", "start", "end", "location"]),
  education: new Set(["school", "degree", "major", "location", "start", "end", "gpa"]),
  projects: new Set(["name", "role", "location", "start", "end", "stack", "link"]),
  research: new Set(["name", "role", "location", "start", "end", "paperTitle", "link"]),
};
const BUILTIN_ORDER_SECTIONS = new Set([
  "experience",
  "education",
  "projects",
  "research",
  "skills",
  "summary",
  "awards",
  "portfolio",
]);

function emptyDoc(): TipTapDoc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function textToDoc(text: string): TipTapDoc {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return emptyDoc();
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultItem(section: string): Record<string, unknown> {
  switch (section) {
    case "experience":
      return { company: "", title: "", start: "", end: "", location: "", content: emptyDoc() };
    case "education":
      return { school: "", degree: "", major: "", location: "", start: "", end: "", gpa: "", highlights: emptyDoc() };
    case "projects":
      return { name: "", role: "", location: "", start: "", end: "", stack: [], link: "", content: emptyDoc() };
    case "research":
      return { name: "", role: "", location: "", start: "", end: "", paperTitle: "", link: "", content: emptyDoc() };
    case "custom":
      return { id: newId(), title: "", content: emptyDoc() };
    default:
      return {};
  }
}

function docFor(operation: ResumeOperation): unknown {
  return operation.replacementTiptapJson !== undefined
    ? operation.replacementTiptapJson
    : textToDoc(operation.afterPlainText);
}

function valueFor(operation: ResumeOperation): unknown {
  return operation.replacementValue !== undefined
    ? operation.replacementValue
    : operation.afterPlainText;
}

export function isAutoApplicableOperation(operation: ResumeOperation): boolean {
  if (operation.riskFlags.length > 0) return false;
  return (
    operation.operation === "update_section" ||
    operation.operation === "insert_section"
  );
}

export function applyResumeOperation(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (operation.operation === "delete_section") {
    return applyDeleteOperation(content, operation);
  }

  if (operation.operation === "reorder_sections" && operation.sectionOrder) {
    return {
      content: { ...content, sectionOrder: operation.sectionOrder },
      changedKeys: ["sectionOrder"],
    };
  }

  if (operation.operation === "reorder_items") {
    return applyReorderItemsOperation(content, operation);
  }

  const isSectionWrite =
    operation.operation === "update_section" ||
    operation.operation === "insert_section";
  if (!isSectionWrite) return null;

  const basicsBlockResult = applyBasicsBlock(content, operation);
  if (basicsBlockResult) return basicsBlockResult;

  const basicsResult = applyBasicsField(content, operation);
  if (basicsResult) return basicsResult;

  const styleBlockResult = applyStyleSettingsBlock(content, operation);
  if (styleBlockResult) return styleBlockResult;

  const styleResult = applyStyleSettingsField(content, operation);
  if (styleResult) return styleResult;

  const arrayItemInsertResult = applyArrayItemInsert(content, operation);
  if (arrayItemInsertResult) return arrayItemInsertResult;

  const metadataResult = applyArrayMetadataField(content, operation);
  if (metadataResult) return metadataResult;

  const customInsertResult = applyCustomInsertItem(content, operation);
  if (customInsertResult) return customInsertResult;

  const customItemBlockResult = applyCustomItemBlock(content, operation);
  if (customItemBlockResult) return customItemBlockResult;

  const customItemFieldResult = applyCustomItemField(content, operation);
  if (customItemFieldResult) return customItemFieldResult;

  // Plain-text profile summary lives on basics. Kept for compatibility with
  // existing operations that predate the generic basics-field branch above.
  if (operation.fieldPath === "basics.summary") {
    return {
      content: { ...content, basics: { ...content.basics, summary: operation.afterPlainText } },
      changedKeys: ["basics"],
    };
  }

  // Top-level TipTap fields (skills/summary/awards/portfolio).
  if (TOP_LEVEL_TIPTAP_FIELDS.has(operation.fieldPath)) {
    const key = operation.fieldPath;
    const next: ResumeContent = { ...content, [key]: docFor(operation) } as ResumeContent;
    const changedKeys = [key];
    if (!content.sectionOrder.includes(key)) {
      next.sectionOrder = [...content.sectionOrder, key];
      changedKeys.push("sectionOrder");
    }
    return { content: next, changedKeys };
  }

  // Array sections: create missing items, then write the field.
  const match = ARRAY_SECTION_FIELD.exec(operation.fieldPath);
  if (match) {
    const section = match[1];
    const index = Number(match[2]);
    const field = match[3];
    const source = content as unknown as Record<string, unknown>;
    const items = Array.isArray(source[section])
      ? [...(source[section] as Record<string, unknown>[])]
      : [];
    while (items.length <= index) items.push(defaultItem(section));
    items[index] = { ...items[index], [field]: docFor(operation) };

    const changedKeys = [section];
    let sectionOrder = content.sectionOrder;
    // built-in array sections render by their key; custom sections by item id.
    const orderKey =
      section === "custom" ? (items[index].id as string) : section;
    if (!sectionOrder.includes(orderKey)) {
      sectionOrder = [...sectionOrder, orderKey];
      changedKeys.push("sectionOrder");
    }

    return {
      content: { ...content, [section]: items, sectionOrder } as ResumeContent,
      changedKeys,
    };
  }

  return null;
}

function applyBasicsBlock(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (operation.fieldPath !== "basics" || !isRecord(operation.replacementValue)) {
    return null;
  }
  const nextValues: Partial<ResumeContent["basics"]> = {};
  for (const [field, value] of Object.entries(operation.replacementValue)) {
    if (!BASICS_FIELDS.has(field)) continue;
    nextValues[field as keyof ResumeContent["basics"]] = String(value);
  }
  if (Object.keys(nextValues).length === 0) return null;
  return {
    content: {
      ...content,
      basics: {
        ...content.basics,
        ...nextValues,
      },
    },
    changedKeys: ["basics"],
  };
}

function applyBasicsField(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  const match = /^basics\.([A-Za-z][A-Za-z0-9]*)$/.exec(operation.fieldPath);
  if (!match) return null;
  const field = match[1];
  if (!BASICS_FIELDS.has(field)) return null;
  return {
    content: {
      ...content,
      basics: {
        ...content.basics,
        [field]: String(valueFor(operation)),
      },
    },
    changedKeys: ["basics"],
  };
}

function applyStyleSettingsBlock(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (operation.fieldPath !== "styleSettings" || !isRecord(operation.replacementValue)) {
    return null;
  }
  const nextValues: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(operation.replacementValue)) {
    const rawValue = coerceStyleValue(field, value);
    if (rawValue !== null) nextValues[field] = rawValue;
  }
  mirrorLineHeightFields(nextValues);
  if (Object.keys(nextValues).length === 0) return null;
  const parsed = StyleSettings.safeParse({
    ...DEFAULT_STYLE_SETTINGS,
    ...(content.styleSettings ?? {}),
    ...nextValues,
  });
  if (!parsed.success) return null;
  return {
    content: { ...content, styleSettings: parsed.data },
    changedKeys: ["styleSettings"],
  };
}

function applyStyleSettingsField(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  const match = /^styleSettings\.([A-Za-z][A-Za-z0-9]*)$/.exec(operation.fieldPath);
  if (!match) return null;
  const field = match[1];
  const rawValue = coerceStyleValue(field, valueFor(operation));
  if (rawValue === null) return null;
  const parsed = StyleSettings.safeParse({
    ...DEFAULT_STYLE_SETTINGS,
    ...(content.styleSettings ?? {}),
    [field]: rawValue,
  });
  if (!parsed.success) return null;
  return {
    content: { ...content, styleSettings: parsed.data },
    changedKeys: ["styleSettings"],
  };
}

function coerceStyleValue(field: string, value: unknown) {
  if (field === "fontFamily") {
    return value === "sans" || value === "serif" || value === "mono"
      ? value
      : null;
  }
  const numericValue = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(numericValue) ? numericValue : null;
}

function mirrorLineHeightFields(values: Record<string, unknown>) {
  if (values.lineHeight !== undefined && values.bodyLineHeight === undefined) {
    values.bodyLineHeight = values.lineHeight;
  }
  if (values.bodyLineHeight !== undefined && values.lineHeight === undefined) {
    values.lineHeight = values.bodyLineHeight;
  }
}

function applyArrayMetadataField(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  const objectMatch = ARRAY_ITEM_PATH.exec(operation.fieldPath);
  if (objectMatch && isRecord(operation.replacementValue)) {
    const section = objectMatch[1];
    const index = Number(objectMatch[2]);
    const allowedFields = ARRAY_METADATA_FIELDS[section];
    if (!allowedFields) return null;
    const source = content as unknown as Record<string, unknown>;
    const items = Array.isArray(source[section])
      ? [...(source[section] as Record<string, unknown>[])]
      : [];
    while (items.length <= index) items.push(defaultItem(section));
    const nextValues: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(operation.replacementValue)) {
      if (!allowedFields.has(field)) continue;
      nextValues[field] = normalizeMetadataValue(section, field, value);
    }
    const richTextField = section === "education" ? "highlights" : "content";
    if (operation.replacementValue[richTextField] !== undefined) {
      nextValues[richTextField] = operation.replacementTiptapJson !== undefined
        ? operation.replacementTiptapJson
        : textToDoc(String(operation.replacementValue[richTextField] ?? ""));
    }
    if (Object.keys(nextValues).length === 0) return null;
    items[index] = {
      ...items[index],
      ...nextValues,
    };
    return {
      content: { ...content, [section]: items } as ResumeContent,
      changedKeys: [section],
    };
  }

  const match = ARRAY_ITEM_FIELD.exec(operation.fieldPath);
  if (!match) return null;
  const section = match[1];
  const index = Number(match[2]);
  const field = match[3];
  if (!ARRAY_METADATA_FIELDS[section]?.has(field)) return null;

  const source = content as unknown as Record<string, unknown>;
  const items = Array.isArray(source[section])
    ? [...(source[section] as Record<string, unknown>[])]
    : [];
  while (items.length <= index) items.push(defaultItem(section));
  items[index] = {
    ...items[index],
    [field]: normalizeMetadataValue(section, field, valueFor(operation)),
  };
  return {
    content: { ...content, [section]: items } as ResumeContent,
    changedKeys: [section],
  };
}

function applyArrayItemInsert(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (operation.operation !== "insert_section") return null;
  const match = ARRAY_ITEM_PATH.exec(operation.fieldPath);
  if (!match || !isRecord(operation.replacementValue)) return null;
  const section = match[1];
  const index = Number(match[2]);
  const allowedFields = ARRAY_METADATA_FIELDS[section];
  if (!allowedFields || index < 0) return null;

  const source = content as unknown as Record<string, unknown>;
  const items = Array.isArray(source[section])
    ? [...(source[section] as Record<string, unknown>[])]
    : [];
  while (items.length < index) items.push(defaultItem(section));

  const metadata: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(operation.replacementValue)) {
    if (allowedFields.has(field)) {
      metadata[field] = normalizeMetadataValue(section, field, value);
    }
  }

  const richTextField = section === "education" ? "highlights" : "content";
  const item = {
    ...defaultItem(section),
    ...metadata,
    [richTextField]: docFor(operation),
  };
  items.splice(Math.min(index, items.length), 0, item);

  const changedKeys = [section];
  let sectionOrder = content.sectionOrder;
  if (!sectionOrder.includes(section)) {
    sectionOrder = [...sectionOrder, section];
    changedKeys.push("sectionOrder");
  }

  return {
    content: { ...content, [section]: items, sectionOrder } as ResumeContent,
    changedKeys,
  };
}

function normalizeMetadataValue(section: string, field: string, value: unknown) {
  if (section === "projects" && field === "stack") {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
    return String(value)
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyCustomInsertItem(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (operation.operation !== "insert_section" || operation.section !== "custom") {
    return null;
  }
  const match = CUSTOM_ITEM_PATH.exec(operation.fieldPath);
  if (!match) return null;
  const items = [...content.custom];
  const rawIndex = Number(match[1]);
  const insertIndex =
    Number.isInteger(rawIndex) && rawIndex >= 0
      ? Math.min(rawIndex, items.length)
      : items.length;
  const item = {
    ...(defaultItem("custom") as ResumeContent["custom"][number]),
    title: customTitleFor(operation),
    content: docFor(operation) as ResumeContent["custom"][number]["content"],
  };
  items.splice(insertIndex, 0, item);
  return {
    content: {
      ...content,
      custom: items,
      sectionOrder: content.sectionOrder.includes(item.id)
        ? content.sectionOrder
        : [...content.sectionOrder, item.id],
    },
    changedKeys: ["custom", "sectionOrder"],
  };
}

function customTitleFor(operation: ResumeOperation) {
  if (isRecord(operation.replacementValue) && operation.replacementValue.title !== undefined) {
    return String(operation.replacementValue.title);
  }
  return "";
}

function applyCustomItemField(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  const match = CUSTOM_ITEM_FIELD.exec(operation.fieldPath);
  if (!match) return null;
  const items = [...content.custom];
  const index = findCustomIndex(items, match[1]);
  if (index === -1) return null;
  const field = match[2];
  items[index] = {
    ...items[index],
    [field]: field === "title" ? String(valueFor(operation)) : docFor(operation),
  };
  return {
    content: { ...content, custom: items },
    changedKeys: ["custom"],
  };
}

function applyCustomItemBlock(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (
    operation.operation !== "update_section" ||
    !isRecord(operation.replacementValue)
  ) {
    return null;
  }
  const match = CUSTOM_ITEM_PATH.exec(operation.fieldPath);
  if (!match) return null;
  const items = [...content.custom];
  const index = findCustomIndex(items, match[1]);
  if (index === -1) return null;
  const nextItem = { ...items[index] };
  let changed = false;
  if (operation.replacementValue.title !== undefined) {
    nextItem.title = String(operation.replacementValue.title);
    changed = true;
  }
  if (operation.replacementValue.content !== undefined) {
    nextItem.content = operation.replacementTiptapJson !== undefined
      ? operation.replacementTiptapJson as ResumeContent["custom"][number]["content"]
      : textToDoc(String(operation.replacementValue.content ?? "")) as ResumeContent["custom"][number]["content"];
    changed = true;
  }
  if (!changed) return null;
  items[index] = nextItem;
  return {
    content: { ...content, custom: items },
    changedKeys: ["custom"],
  };
}

function applyDeleteOperation(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (BUILTIN_ORDER_SECTIONS.has(operation.fieldPath)) {
    return {
      content: {
        ...content,
        sectionOrder: content.sectionOrder.filter((key) => key !== operation.fieldPath),
      },
      changedKeys: ["sectionOrder"],
    };
  }

  const arrayMatch = ARRAY_ITEM_PATH.exec(operation.fieldPath);
  if (arrayMatch) {
    const section = arrayMatch[1];
    const index = Number(arrayMatch[2]);
    const source = content as unknown as Record<string, unknown>;
    const items = Array.isArray(source[section])
      ? [...(source[section] as Record<string, unknown>[])]
      : [];
    if (index < 0 || index >= items.length) return null;
    items.splice(index, 1);
    return {
      content: { ...content, [section]: items } as ResumeContent,
      changedKeys: [section],
    };
  }

  const customMatch = CUSTOM_ITEM_PATH.exec(operation.fieldPath);
  if (customMatch) {
    const items = [...content.custom];
    const index = findCustomIndex(items, customMatch[1]);
    if (index === -1) return null;
    const [removed] = items.splice(index, 1);
    return {
      content: {
        ...content,
        custom: items,
        sectionOrder: content.sectionOrder.filter((key) => key !== removed.id),
      },
      changedKeys: ["custom", "sectionOrder"],
    };
  }

  return null;
}

function applyReorderItemsOperation(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  const section = operation.fieldPath;
  if (!["experience", "education", "projects", "research", "custom"].includes(section)) {
    return null;
  }
  const source = content as unknown as Record<string, unknown>;
  const items = Array.isArray(source[section])
    ? [...(source[section] as Record<string, unknown>[])]
    : [];
  if (!operation.itemOrder || operation.itemOrder.length !== items.length) return null;

  const reordered =
    section === "custom" && operation.itemOrder.every((item) => typeof item === "string")
      ? reorderCustomItems(items, operation.itemOrder as string[])
      : reorderByIndexes(items, operation.itemOrder);
  if (!reordered) return null;

  return {
    content: { ...content, [section]: reordered } as ResumeContent,
    changedKeys: [section],
  };
}

function reorderByIndexes(
  items: Record<string, unknown>[],
  itemOrder: Array<string | number>,
) {
  if (!itemOrder.every((item) => typeof item === "number")) return null;
  const seen = new Set<number>();
  const next: Record<string, unknown>[] = [];
  for (const index of itemOrder as number[]) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) {
      return null;
    }
    seen.add(index);
    next.push(items[index]);
  }
  return next;
}

function reorderCustomItems(
  items: Record<string, unknown>[],
  itemOrder: string[],
) {
  const byId = new Map(
    items
      .filter((item): item is Record<string, unknown> & { id: string } => typeof item.id === "string")
      .map((item) => [item.id, item]),
  );
  if (byId.size !== items.length) return null;
  const next: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const id of itemOrder) {
    const item = byId.get(id);
    if (!item || seen.has(id)) return null;
    seen.add(id);
    next.push(item);
  }
  return next;
}

function findCustomIndex(items: ResumeContent["custom"], ref: string) {
  const index = Number(ref);
  if (Number.isInteger(index) && index >= 0 && index < items.length) {
    return index;
  }
  return items.findIndex((item) => item.id === ref);
}
