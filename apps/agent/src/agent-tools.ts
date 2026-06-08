export type AgentToolName =
  | "inspect_resume"
  | "propose_rich_text_rewrite"
  | "propose_summary_rewrite"
  | "propose_bullet_rewrite"
  | "draft_section_item";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type ResumePatch = {
  id: string;
  toolCallId: string;
  label: string;
  section:
    | "summary"
    | "experience"
    | "projects"
    | "education"
    | "skills"
    | "research"
    | "custom";
  fieldPath: string;
  operation: "replace_plain_text" | "replace_tiptap_json";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  changeSummary: string;
  riskFlags: Array<{
    type:
      | "needs_user_fact"
      | "possible_fabrication"
      | "formatting_risk"
      | "unsafe_claim";
    message: string;
  }>;
};

export type AgentToolOutput = {
  toolCalls: AgentToolCall[];
  proposedPatches: ResumePatch[];
};

const TOOL_NAMES = new Set<AgentToolName>([
  "inspect_resume",
  "propose_rich_text_rewrite",
  "propose_summary_rewrite",
  "propose_bullet_rewrite",
  "draft_section_item",
]);

const SECTIONS = new Set<ResumePatch["section"]>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);

const PATCH_OPERATIONS = new Set<ResumePatch["operation"]>([
  "replace_plain_text",
  "replace_tiptap_json",
]);

const RISK_TYPES = new Set<ResumePatch["riskFlags"][number]["type"]>([
  "needs_user_fact",
  "possible_fabrication",
  "formatting_risk",
  "unsafe_claim",
]);

export function isAllowedPatchFieldPath(fieldPath: string): boolean {
  return (
    fieldPath === "basics.summary" ||
    fieldPath === "skills" ||
    /^experience\.\d+\.content$/.test(fieldPath) ||
    /^projects\.\d+\.content$/.test(fieldPath) ||
    /^education\.\d+\.highlights$/.test(fieldPath) ||
    /^research\.\d+\.content$/.test(fieldPath) ||
    /^custom\.\d+\.content$/.test(fieldPath)
  );
}

export function validateAgentToolOutput(
  value: unknown,
): { ok: true; output: AgentToolOutput } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "tool output must be an object" };
  }
  if (!Array.isArray(value.toolCalls)) {
    return { ok: false, message: "toolCalls must be an array" };
  }
  if (!Array.isArray(value.proposedPatches)) {
    return { ok: false, message: "proposedPatches must be an array" };
  }

  const toolCalls: AgentToolCall[] = [];
  const toolIds = new Set<string>();
  for (const item of value.toolCalls) {
    const parsed = parseToolCall(item);
    if (!parsed.ok) return parsed;
    toolIds.add(parsed.toolCall.id);
    toolCalls.push(parsed.toolCall);
  }

  const proposedPatches: ResumePatch[] = [];
  for (const item of value.proposedPatches) {
    const parsed = parsePatch(item, toolIds);
    if (!parsed.ok) return parsed;
    proposedPatches.push(parsed.patch);
  }

  return { ok: true, output: { toolCalls, proposedPatches } };
}

function parseToolCall(
  value: unknown,
): { ok: true; toolCall: AgentToolCall } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "tool call must be an object" };
  }
  const id = requiredString(value.id, "toolCall.id");
  if (!id.ok) return id;
  if (!TOOL_NAMES.has(value.name as AgentToolName)) {
    return { ok: false, message: "toolCall.name is not supported" };
  }
  const title = requiredString(value.title, "toolCall.title");
  if (!title.ok) return title;
  const summary = requiredString(value.summary, "toolCall.summary");
  if (!summary.ok) return summary;
  if (!isRecord(value.input)) {
    return { ok: false, message: "toolCall.input must be an object" };
  }
  if (!isRecord(value.result)) {
    return { ok: false, message: "toolCall.result must be an object" };
  }

  return {
    ok: true,
    toolCall: {
      id: id.value,
      name: value.name as AgentToolName,
      status: "completed",
      title: title.value,
      summary: summary.value,
      input: value.input,
      result: value.result,
    },
  };
}

function parsePatch(
  value: unknown,
  toolIds: Set<string>,
): { ok: true; patch: ResumePatch } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "patch must be an object" };
  const id = requiredString(value.id, "patch.id");
  if (!id.ok) return id;
  const toolCallId = requiredString(value.toolCallId, "patch.toolCallId");
  if (!toolCallId.ok) return toolCallId;
  if (!toolIds.has(toolCallId.value)) {
    return { ok: false, message: "patch.toolCallId must reference a tool call" };
  }
  const label = requiredString(value.label, "patch.label");
  if (!label.ok) return label;
  if (!SECTIONS.has(value.section as ResumePatch["section"])) {
    return { ok: false, message: "patch.section is invalid" };
  }
  const fieldPath = requiredString(value.fieldPath, "patch.fieldPath");
  if (!fieldPath.ok) return fieldPath;
  if (!isAllowedPatchFieldPath(fieldPath.value)) {
    return { ok: false, message: "patch.fieldPath is not allowed" };
  }
  if (!PATCH_OPERATIONS.has(value.operation as ResumePatch["operation"])) {
    return { ok: false, message: "patch.operation is invalid" };
  }
  const beforePlainText = requiredString(
    value.beforePlainText,
    "patch.beforePlainText",
  );
  if (!beforePlainText.ok) return beforePlainText;
  const afterPlainText = requiredString(
    value.afterPlainText,
    "patch.afterPlainText",
  );
  if (!afterPlainText.ok) return afterPlainText;
  const changeSummary = requiredString(
    value.changeSummary,
    "patch.changeSummary",
  );
  if (!changeSummary.ok) return changeSummary;
  if (!Array.isArray(value.riskFlags)) {
    return { ok: false, message: "patch.riskFlags must be an array" };
  }

  const riskFlags: ResumePatch["riskFlags"] = [];
  for (const flag of value.riskFlags) {
    if (!isRecord(flag)) {
      return { ok: false, message: "patch risk flag must be an object" };
    }
    if (!RISK_TYPES.has(flag.type as ResumePatch["riskFlags"][number]["type"])) {
      return { ok: false, message: "patch risk flag type is invalid" };
    }
    const message = requiredString(flag.message, "patch.riskFlags.message");
    if (!message.ok) return message;
    riskFlags.push({
      type: flag.type as ResumePatch["riskFlags"][number]["type"],
      message: message.value,
    });
  }

  return {
    ok: true,
    patch: {
      id: id.value,
      toolCallId: toolCallId.value,
      label: label.value,
      section: value.section as ResumePatch["section"],
      fieldPath: fieldPath.value,
      operation: value.operation as ResumePatch["operation"],
      beforePlainText: beforePlainText.value,
      afterPlainText: afterPlainText.value,
      ...(value.replacementTiptapJson === undefined
        ? {}
        : { replacementTiptapJson: value.replacementTiptapJson }),
      changeSummary: changeSummary.value,
      riskFlags,
    },
  };
}

function requiredString(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, message: `${field} is required` };
  }
  return { ok: true, value: value.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
