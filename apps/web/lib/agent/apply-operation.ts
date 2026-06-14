import type { ResumeContent } from "@intro-builder/shared/schemas";
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

const TOP_LEVEL_TIPTAP_FIELDS = new Set([
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

export function applyResumeOperation(
  content: ResumeContent,
  operation: ResumeOperation,
): ApplyResumeOperationResult {
  if (operation.operation === "reorder_sections" && operation.sectionOrder) {
    return {
      content: { ...content, sectionOrder: operation.sectionOrder },
      changedKeys: ["sectionOrder"],
    };
  }

  const isSectionWrite =
    operation.operation === "update_section" ||
    operation.operation === "insert_section";
  if (!isSectionWrite) return null;

  // Plain-text profile summary lives on basics.
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
