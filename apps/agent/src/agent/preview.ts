import { randomUUID } from "node:crypto";

import type {
  AgentDraftResumeSnapshot,
  AgentDraftResumeSection,
} from "../agent-messages.js";
import type { ResumeOperation } from "../agent-tools.js";
import { isAllowedOperationFieldPath } from "../agent-tools.js";

/**
 * Preview resume model for the AI SDK chat loop.
 *
 * Every write tool mutates THIS in-memory preview — never the real resume in
 * Postgres. The preview accumulates a last-write-wins set of `ResumeOperation`s
 * (compatible with the web apply path) plus a display snapshot. The real resume
 * only changes when the user applies the preview (handled on the web side).
 */

export type PreviewSection = AgentDraftResumeSection;

export type PreviewState = {
  resumeId: string | null;
  title: string;
  targetRole: string | null;
  profileSummary: string;
  sections: PreviewSection[];
  /** Last-write-wins per fieldPath. */
  operations: ResumeOperation[];
  byFieldPath: Map<string, string>;
};

/** Hard cap on distinct previewed fields per session (loop guardrail). */
export const MAX_PREVIEW_OPERATIONS = 24;

const PROFILE_FIELD_PATH = "basics.summary";

export function createPreview(input?: {
  resumeId?: string | null;
  title?: string;
  targetRole?: string | null;
}): PreviewState {
  return {
    resumeId: input?.resumeId ?? null,
    title: input?.title?.trim() || "新简历",
    targetRole: input?.targetRole ?? null,
    profileSummary: "",
    sections: [],
    operations: [],
    byFieldPath: new Map(),
  };
}

/** Field paths whose resume value is TipTap JSON (everything except basics.summary). */
function isTipTapContentField(fieldPath: string): boolean {
  return (
    fieldPath === "skills" ||
    /^experience\.\d+\.content$/.test(fieldPath) ||
    /^projects\.\d+\.content$/.test(fieldPath) ||
    /^education\.\d+\.highlights$/.test(fieldPath) ||
    /^research\.\d+\.content$/.test(fieldPath) ||
    /^custom\.\d+\.content$/.test(fieldPath)
  );
}

/** Convert plain text (with "- " bullets) into a TipTap doc so the produced
 *  operation applies directly through the editor's TipTap path. */
export function plainTextToTipTapDoc(text: string): {
  type: "doc";
  content: unknown[];
} {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const nonEmpty = lines.filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
  if (bulletLines.length > 0 && bulletLines.length === nonEmpty.length) {
    return {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: bulletLines.map((line) => ({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: line.replace(/^[-*]\s+/, "") }],
              },
            ],
          })),
        },
      ],
    };
  }
  return {
    type: "doc",
    content: nonEmpty.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

export type ApplyWriteInput = {
  toolCallId: string;
  section: ResumeOperation["section"];
  fieldPath: string;
  label: string;
  afterPlainText: string;
  changeSummary?: string;
  status?: PreviewSection["status"];
};

export function applyWrite(
  preview: PreviewState,
  input: ApplyWriteInput,
): { ok: true; operation: ResumeOperation } | { ok: false; message: string } {
  const fieldPath = input.fieldPath.trim();
  if (!isAllowedOperationFieldPath(fieldPath)) {
    return { ok: false, message: `fieldPath is not allowed: ${fieldPath}` };
  }
  const afterPlainText = input.afterPlainText.trim();
  if (!afterPlainText) {
    return { ok: false, message: "afterPlainText is required" };
  }
  const isNewField = !preview.byFieldPath.has(fieldPath);
  if (isNewField && preview.operations.length >= MAX_PREVIEW_OPERATIONS) {
    return {
      ok: false,
      message: `preview operation limit reached (${MAX_PREVIEW_OPERATIONS})`,
    };
  }

  const label = input.label.trim() || input.section;
  const toolCallId = input.toolCallId.trim() || `tool_${randomUUID()}`;
  const previousOpId = preview.byFieldPath.get(fieldPath);
  const previous = previousOpId
    ? preview.operations.find((op) => op.id === previousOpId) ?? null
    : null;
  const isUpdate = previous !== null;

  const replacementTiptapJson = isTipTapContentField(fieldPath)
    ? plainTextToTipTapDoc(afterPlainText)
    : undefined;

  const operation: ResumeOperation = {
    id: `op_${randomUUID()}`,
    toolCallId,
    label,
    section: input.section,
    fieldPath,
    operation: isUpdate ? "update_section" : "insert_section",
    beforePlainText: previous?.afterPlainText ?? "（空）",
    afterPlainText,
    ...(replacementTiptapJson === undefined ? {} : { replacementTiptapJson }),
    changeSummary:
      input.changeSummary?.trim() || `${isUpdate ? "更新" : "新增"}${label}`,
    riskFlags: [],
  };

  if (previousOpId) {
    preview.operations = preview.operations.filter(
      (existing) => existing.id !== previousOpId,
    );
  }
  preview.operations.push(operation);
  preview.byFieldPath.set(fieldPath, operation.id);

  const row: PreviewSection = {
    key: input.section,
    label,
    summary: summarize(afterPlainText),
    status: input.status ?? "drafted",
  };
  const rowIndex = preview.sections.findIndex(
    (section) => section.key === input.section && section.label === label,
  );
  if (rowIndex === -1) preview.sections.push(row);
  else preview.sections[rowIndex] = row;

  if (fieldPath === PROFILE_FIELD_PATH) preview.profileSummary = afterPlainText;

  return { ok: true, operation };
}

export function setPreviewGoal(
  preview: PreviewState,
  input: { title?: string; targetRole?: string | null },
): void {
  if (typeof input.title === "string" && input.title.trim()) {
    preview.title = input.title.trim();
  }
  if (input.targetRole !== undefined) preview.targetRole = input.targetRole;
}

export function previewSnapshot(preview: PreviewState): AgentDraftResumeSnapshot {
  return {
    title: preview.title,
    targetRole: preview.targetRole,
    profileSummary: preview.profileSummary,
    sections: [...preview.sections],
    missingFacts: preview.sections
      .filter((section) => section.status === "needs_user_fact")
      .map((section) => section.label),
  };
}

function summarize(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}
