export type AgentToolName =
  | "resume_read"
  | "resume_update_section"
  | "resume_delete_section"
  | "resume_reorder_sections"
  | "resume_insert_section";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type ResumeOperation = {
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
  operation:
    | "update_section"
    | "delete_section"
    | "reorder_sections"
    | "insert_section";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  sectionOrder?: string[];
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
  proposedOperations: ResumeOperation[];
};

const TOOL_NAMES = new Set<AgentToolName>([
  "resume_read",
  "resume_update_section",
  "resume_delete_section",
  "resume_reorder_sections",
  "resume_insert_section",
]);

const SECTIONS = new Set<ResumeOperation["section"]>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);

const OPERATION_NAMES = new Set<ResumeOperation["operation"]>([
  "update_section",
  "delete_section",
  "reorder_sections",
  "insert_section",
]);

const RISK_TYPES = new Set<ResumeOperation["riskFlags"][number]["type"]>([
  "needs_user_fact",
  "possible_fabrication",
  "formatting_risk",
  "unsafe_claim",
]);

export function isAllowedOperationFieldPath(fieldPath: string): boolean {
  return (
    fieldPath === "basics.summary" ||
    fieldPath === "skills" ||
    fieldPath === "sectionOrder" ||
    /^experience\.\d+\.content$/.test(fieldPath) ||
    /^projects\.\d+\.content$/.test(fieldPath) ||
    /^education\.\d+\.highlights$/.test(fieldPath) ||
    /^research\.\d+\.content$/.test(fieldPath) ||
    /^custom\.\d+\.content$/.test(fieldPath)
  );
}

export const isAllowedPatchFieldPath = isAllowedOperationFieldPath;

export function validateAgentToolOutput(
  value: unknown,
): { ok: true; output: AgentToolOutput } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "tool output must be an object" };
  }
  if (!Array.isArray(value.toolCalls)) {
    return { ok: false, message: "toolCalls must be an array" };
  }
  if (!Array.isArray(value.proposedOperations)) {
    return { ok: false, message: "proposedOperations must be an array" };
  }

  const toolCalls: AgentToolCall[] = [];
  const toolIds = new Set<string>();
  for (const item of value.toolCalls) {
    const parsed = parseToolCall(item);
    if (!parsed.ok) return parsed;
    toolIds.add(parsed.toolCall.id);
    toolCalls.push(parsed.toolCall);
  }

  const proposedOperations: ResumeOperation[] = [];
  for (const item of value.proposedOperations) {
    const parsed = parseOperation(item, toolIds);
    if (!parsed.ok) return parsed;
    proposedOperations.push(parsed.operation);
  }

  return { ok: true, output: { toolCalls, proposedOperations } };
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

function parseOperation(
  value: unknown,
  toolIds: Set<string>,
): { ok: true; operation: ResumeOperation } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "operation must be an object" };
  const id = requiredString(value.id, "operation.id");
  if (!id.ok) return id;
  const toolCallId = requiredString(value.toolCallId, "operation.toolCallId");
  if (!toolCallId.ok) return toolCallId;
  if (!toolIds.has(toolCallId.value)) {
    return { ok: false, message: "operation.toolCallId must reference a tool call" };
  }
  const label = requiredString(value.label, "operation.label");
  if (!label.ok) return label;
  if (!SECTIONS.has(value.section as ResumeOperation["section"])) {
    return { ok: false, message: "operation.section is invalid" };
  }
  const fieldPath = requiredString(value.fieldPath, "operation.fieldPath");
  if (!fieldPath.ok) return fieldPath;
  if (!isAllowedOperationFieldPath(fieldPath.value)) {
    return { ok: false, message: "operation.fieldPath is not allowed" };
  }
  if (!OPERATION_NAMES.has(value.operation as ResumeOperation["operation"])) {
    return { ok: false, message: "operation.operation is invalid" };
  }
  const beforePlainText = requiredString(
    value.beforePlainText,
    "operation.beforePlainText",
  );
  if (!beforePlainText.ok) return beforePlainText;
  const afterPlainText = requiredString(
    value.afterPlainText,
    "operation.afterPlainText",
  );
  if (!afterPlainText.ok) return afterPlainText;
  const changeSummary = requiredString(
    value.changeSummary,
    "operation.changeSummary",
  );
  if (!changeSummary.ok) return changeSummary;
  if (!Array.isArray(value.riskFlags)) {
    return { ok: false, message: "operation.riskFlags must be an array" };
  }

  const operationName = value.operation as ResumeOperation["operation"];
  const sectionOrder = parseSectionOrder(value.sectionOrder, operationName);
  if (!sectionOrder.ok) return sectionOrder;

  const riskFlags: ResumeOperation["riskFlags"] = [];
  for (const flag of value.riskFlags) {
    if (!isRecord(flag)) {
      return { ok: false, message: "operation risk flag must be an object" };
    }
    if (!RISK_TYPES.has(flag.type as ResumeOperation["riskFlags"][number]["type"])) {
      return { ok: false, message: "operation risk flag type is invalid" };
    }
    const message = requiredString(flag.message, "operation.riskFlags.message");
    if (!message.ok) return message;
    riskFlags.push({
      type: flag.type as ResumeOperation["riskFlags"][number]["type"],
      message: message.value,
    });
  }

  return {
    ok: true,
    operation: {
      id: id.value,
      toolCallId: toolCallId.value,
      label: label.value,
      section: value.section as ResumeOperation["section"],
      fieldPath: fieldPath.value,
      operation: operationName,
      beforePlainText: beforePlainText.value,
      afterPlainText: afterPlainText.value,
      ...(value.replacementTiptapJson === undefined
        ? {}
        : { replacementTiptapJson: value.replacementTiptapJson }),
      ...(sectionOrder.value === undefined
        ? {}
        : { sectionOrder: sectionOrder.value }),
      changeSummary: changeSummary.value,
      riskFlags,
    },
  };
}

function parseSectionOrder(
  value: unknown,
  operation: ResumeOperation["operation"],
):
  | { ok: true; value?: string[] }
  | { ok: false; message: string } {
  if (operation !== "reorder_sections") return { ok: true };
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return { ok: false, message: "operation.sectionOrder must be a string array" };
  }
  if (!value.includes("basics")) {
    return { ok: false, message: "operation.sectionOrder must include basics" };
  }
  return { ok: true, value };
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
