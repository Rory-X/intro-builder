import { randomUUID } from "node:crypto";

import type { AgentDraftResumeSnapshot } from "../agent-messages.js";
import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";
import { isAllowedOperationFieldPath } from "../agent-tools.js";
import type { AgentResumeWorkspaceSnapshot } from "./resume-workspace.js";

/**
 * Draft model for the real agent loop.
 *
 * 在 loop 回合内，写工具的 execute 只改这里的 draft（不碰真简历）。draft 累积一串
 * `ResumeOperation`（按 fieldPath 末次写入为准）以及与之配对的 `AgentToolCall`，
 * loop 结束后由 {@link draftToChangeSet} 汇成一个待审批的 change-set，真简历只在用户
 * 同意应用时由 Web BFF 落盘。
 *
 * 设计约束：产出的 {toolCalls, operations} 必须能通过既有
 * `validateAgentToolOutput`，从而无缝复用现有 AG-UI 事件 / workspace 装配管线。
 */

export type DraftSection = AgentDraftResumeSnapshot["sections"][number];
export type AgentChangeSet = AgentResumeWorkspaceSnapshot["changeSets"][number];

export type DraftState = {
  title: string;
  targetRole: string | null;
  profileSummary: string;
  /** Display rows, ordered by first insertion, keyed internally by fieldPath. */
  sections: DraftSection[];
  /** Accumulated operations, last-write-wins per fieldPath. */
  operations: ResumeOperation[];
  /** One tool call per applied write, in invocation order (loop history). */
  toolCalls: AgentToolCall[];
  /** Internal index: fieldPath -> operation id, to dedupe last-write-wins. */
  byFieldPath: Map<string, string>;
};

const PROFILE_FIELD_PATH = "basics.summary";

export function createDraft(input?: {
  title?: string;
  targetRole?: string | null;
}): DraftState {
  return {
    title: input?.title?.trim() || "新简历",
    targetRole: input?.targetRole ?? null,
    profileSummary: "",
    sections: [],
    operations: [],
    toolCalls: [],
    byFieldPath: new Map(),
  };
}

export function setGoal(
  draft: DraftState,
  input: { title?: string; targetRole?: string | null },
): void {
  if (typeof input.title === "string" && input.title.trim()) {
    draft.title = input.title.trim();
  }
  if (input.targetRole !== undefined) {
    draft.targetRole = input.targetRole;
  }
}

export type UpsertSectionInput = {
  /** AI SDK tool call id; becomes the AgentToolCall id and the operation.toolCallId. */
  toolCallId: string;
  section: ResumeOperation["section"];
  fieldPath: string;
  label: string;
  afterPlainText: string;
  changeSummary?: string;
  replacementTiptapJson?: unknown;
  status?: DraftSection["status"];
  riskFlags?: ResumeOperation["riskFlags"];
};

/**
 * Apply one write to the draft. Returns the produced operation, or a failure if
 * the field path is not an allowed resume operation target.
 */
export function upsertSection(
  draft: DraftState,
  input: UpsertSectionInput,
): { ok: true; operation: ResumeOperation } | { ok: false; message: string } {
  const fieldPath = input.fieldPath.trim();
  if (!isAllowedOperationFieldPath(fieldPath)) {
    return { ok: false, message: `fieldPath is not allowed: ${fieldPath}` };
  }
  const afterPlainText = input.afterPlainText.trim();
  if (!afterPlainText) {
    return { ok: false, message: "afterPlainText is required" };
  }
  const label = input.label.trim() || sectionLabel(input.section);
  const toolCallId = input.toolCallId.trim() || `tool_${randomUUID()}`;

  const previousOpId = draft.byFieldPath.get(fieldPath);
  const previous = previousOpId
    ? draft.operations.find((operation) => operation.id === previousOpId) ?? null
    : null;
  const isUpdate = previous !== null;

  const operation: ResumeOperation = {
    id: `op_${randomUUID()}`,
    toolCallId,
    label,
    section: input.section,
    fieldPath,
    operation: isUpdate ? "update_section" : "insert_section",
    // parseOperation requires non-empty strings; inserts have no prior text.
    beforePlainText: previous?.afterPlainText ?? "（空）",
    afterPlainText,
    ...(input.replacementTiptapJson === undefined
      ? {}
      : { replacementTiptapJson: input.replacementTiptapJson }),
    changeSummary: input.changeSummary?.trim() || `${isUpdate ? "更新" : "新增"}${label}`,
    riskFlags: input.riskFlags ?? [],
  };

  // Last-write-wins: drop any prior operation for this field path.
  if (previousOpId) {
    draft.operations = draft.operations.filter(
      (existing) => existing.id !== previousOpId,
    );
  }
  draft.operations.push(operation);
  draft.byFieldPath.set(fieldPath, operation.id);

  draft.toolCalls.push({
    id: toolCallId,
    name: isUpdate ? "resume_update_section" : "resume_insert_section",
    status: "completed",
    title: label,
    summary: operation.changeSummary,
    input: {
      operation: operation.operation,
      section: operation.section,
      fieldPath,
    },
    result: { operationIds: [operation.id] },
  });

  const row: DraftSection = {
    key: input.section,
    label,
    summary: summarize(afterPlainText),
    status: input.status ?? "drafted",
  };
  const rowIndex = draft.sections.findIndex(
    (section) => section.key === input.section && section.label === label,
  );
  if (rowIndex === -1) {
    draft.sections.push(row);
  } else {
    draft.sections[rowIndex] = row;
  }

  if (fieldPath === PROFILE_FIELD_PATH) {
    draft.profileSummary = afterPlainText;
  }

  return { ok: true, operation };
}

export function draftSnapshot(draft: DraftState): AgentDraftResumeSnapshot {
  return {
    title: draft.title,
    targetRole: draft.targetRole,
    profileSummary: draft.profileSummary,
    sections: [...draft.sections],
    missingFacts: [...draft.sections]
      .filter((section) => section.status === "needs_user_fact")
      .map((section) => section.label),
  };
}

/**
 * Diff the draft against its base (empty for create-from-zero) into a single
 * staged change-set. Returns null when the draft has no write operations.
 */
export function draftToChangeSet(
  draft: DraftState,
  options: { requestId: string; now?: string },
): AgentChangeSet | null {
  if (draft.operations.length === 0) return null;
  const now = options.now ?? new Date().toISOString();
  const operations = [...draft.operations];
  return {
    id: `changeset_${safeId(options.requestId)}`,
    title: draft.title ? `${draft.title} · 待确认修改` : "待确认修改",
    summary: summarizeOperations(operations),
    status: "staged",
    operationIds: operations.map((operation) => operation.id),
    operations,
    createdAt: now,
  };
}

function summarize(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function summarizeOperations(operations: ResumeOperation[]): string {
  const summaries = operations
    .map((operation) => operation.changeSummary.trim())
    .filter(Boolean);
  if (summaries.length === 0) return `包含 ${operations.length} 条修改`;
  return summaries.join("；");
}

function sectionLabel(section: ResumeOperation["section"]): string {
  const labels: Record<ResumeOperation["section"], string> = {
    summary: "个人简介",
    experience: "工作经历",
    projects: "项目经历",
    education: "教育经历",
    skills: "技能",
    research: "研究经历",
    custom: "自定义",
  };
  return labels[section];
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const TOOL_NAME_BY_OPERATION: Record<
  ResumeOperation["operation"],
  AgentToolCall["name"]
> = {
  update_section: "resume_update_section",
  delete_section: "resume_delete_section",
  reorder_sections: "resume_reorder_sections",
  insert_section: "resume_insert_section",
};

/**
 * Rebuild a draft from a stored workspace snapshot so a follow-up loop turn
 * continues editing the same draft (续上对话) instead of starting over.
 */
export function rehydrateDraft(
  workspace: AgentResumeWorkspaceSnapshot,
): DraftState {
  const draft = createDraft({
    title: workspace.draftResume?.title ?? workspace.goal.resumeTitle,
    targetRole: workspace.draftResume?.targetRole ?? workspace.goal.targetRole,
  });
  draft.profileSummary = workspace.draftResume?.profileSummary ?? "";
  if (workspace.draftResume) {
    draft.sections = workspace.draftResume.sections.map((section) => ({
      ...section,
    }));
  }

  const latestChangeSet =
    [...workspace.changeSets]
      .reverse()
      .find((changeSet) => changeSet.status === "staged") ??
    workspace.changeSets.at(-1) ??
    null;

  if (latestChangeSet) {
    for (const operation of latestChangeSet.operations) {
      draft.operations.push(operation);
      draft.byFieldPath.set(operation.fieldPath, operation.id);
      draft.toolCalls.push({
        id: operation.toolCallId,
        name: TOOL_NAME_BY_OPERATION[operation.operation],
        status: "completed",
        title: operation.label,
        summary: operation.changeSummary,
        input: {
          operation: operation.operation,
          section: operation.section,
          fieldPath: operation.fieldPath,
        },
        result: { operationIds: [operation.id] },
      });
    }
  }

  return draft;
}
