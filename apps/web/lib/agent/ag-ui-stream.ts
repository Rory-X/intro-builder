import { BaseEventSchema, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import type {
  AgentContextStatusSnapshot,
  AgentResumeWorkspaceSnapshot,
  AgentToolCall,
  ResumeOperation,
} from "@intro-builder/shared/types";

export type AgUiResumeToolResult = {
  toolCall: AgentToolCall;
  proposedOperations: ResumeOperation[];
};

export type AgUiAgentQuestion = {
  toolCallId: string;
  question: string;
  field?: string;
};

export type AgUiContextStatus = AgentContextStatusSnapshot;
export type AgUiResumeWorkspace = AgentResumeWorkspaceSnapshot;

export function createAgUiSseStream(
  events: Iterable<BaseEvent>,
  accept?: string,
): ReadableStream<Uint8Array> {
  const encoder = new EventEncoder({ accept });
  const textEncoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(textEncoder.encode(encoder.encode(event)));
      }
      controller.close();
    },
  });
}

export async function* readAgUiSseStream(
  response: Response,
): AsyncGenerator<BaseEvent> {
  if (!response.body) {
    throw new Error("AG-UI stream response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      yield* drainSseEvents(buffer, (nextBuffer) => {
        buffer = nextBuffer;
      });
    }

    buffer += decoder.decode();
    yield* drainSseEvents(`${buffer}\n\n`, (nextBuffer) => {
      buffer = nextBuffer;
    });
  } finally {
    reader.releaseLock();
  }
}

function* drainSseEvents(
  buffer: string,
  setBuffer: (buffer: string) => void,
): Generator<BaseEvent> {
  let nextBuffer = buffer;
  let boundary = nextBuffer.indexOf("\n\n");

  while (boundary !== -1) {
    const rawEvent = nextBuffer.slice(0, boundary);
    nextBuffer = nextBuffer.slice(boundary + 2);
    boundary = nextBuffer.indexOf("\n\n");

    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");

    if (!data.trim()) continue;
    yield parseAgUiEvent(data);
  }

  setBuffer(nextBuffer);
}

function parseAgUiEvent(data: string): BaseEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error("Invalid AG-UI event JSON", { cause: error });
  }

  const result = BaseEventSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Invalid AG-UI event", { cause: result.error });
  }
  return result.data;
}

export function extractAgUiResumeToolResult(
  event: BaseEvent,
): AgUiResumeToolResult | null {
  if (event.type !== "TOOL_CALL_RESULT") return null;
  if (typeof event.content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isAgentToolCall(parsed.toolCall)) return null;
  if (!Array.isArray(parsed.proposedOperations)) return null;

  return {
    toolCall: parsed.toolCall,
    proposedOperations: parsed.proposedOperations.filter(isResumeOperation),
  };
}

export function extractAgUiContextStatus(event: BaseEvent): AgUiContextStatus | null {
  if (event.type === "ACTIVITY_SNAPSHOT") {
    const body = event as {
      activityType?: unknown;
      content?: unknown;
    };
    if (body.activityType !== "context_status") return null;
    return isAgentContextStatus(body.content) ? body.content : null;
  }

  if (event.type === "STATE_DELTA") {
    const body = event as { delta?: unknown };
    if (!Array.isArray(body.delta)) return null;
    for (const patch of body.delta) {
      if (!isRecord(patch)) continue;
      if (patch.path !== "/contextStatus") continue;
      if (isAgentContextStatus(patch.value)) return patch.value;
    }
  }

  return null;
}

export function extractAgUiResumeWorkspace(
  event: BaseEvent,
): AgUiResumeWorkspace | null {
  if (event.type === "ACTIVITY_SNAPSHOT") {
    const body = event as {
      activityType?: unknown;
      content?: unknown;
    };
    if (body.activityType !== "resume_workspace") return null;
    return isAgentResumeWorkspace(body.content) ? body.content : null;
  }

  if (event.type === "STATE_DELTA") {
    const body = event as { delta?: unknown };
    if (!Array.isArray(body.delta)) return null;
    for (const patch of body.delta) {
      if (!isRecord(patch)) continue;
      if (patch.path !== "/workspace") continue;
      if (isAgentResumeWorkspace(patch.value)) return patch.value;
    }
  }

  return null;
}

export function extractAgUiQuestion(event: BaseEvent): AgUiAgentQuestion | null {
  if (event.type !== "TOOL_CALL_RESULT") return null;
  if (typeof event.content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const toolCall = parsed.toolCall;
  if (!isRecord(toolCall)) return null;
  if (toolCall.name !== "resume_ask") return null;

  const question = typeof parsed.question === "string" ? parsed.question : null;
  if (!question) return null;

  return {
    toolCallId: typeof toolCall.id === "string" ? toolCall.id : "",
    question,
    field: typeof parsed.field === "string" ? parsed.field : undefined,
  };
}

function isAgentToolCall(value: unknown): value is AgentToolCall {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isAgentToolName(value.name) &&
    value.status === "completed" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    isRecord(value.input) &&
    isRecord(value.result)
  );
}

function isResumeOperation(value: unknown): value is ResumeOperation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.label === "string" &&
    typeof value.section === "string" &&
    typeof value.fieldPath === "string" &&
    isResumeOperationName(value.operation) &&
    typeof value.beforePlainText === "string" &&
    typeof value.afterPlainText === "string" &&
    typeof value.changeSummary === "string" &&
    Array.isArray(value.riskFlags)
  );
}

function isAgentToolName(value: unknown): value is AgentToolCall["name"] {
  return (
    value === "resume_read" ||
    value === "resume_update_section" ||
    value === "resume_delete_section" ||
    value === "resume_reorder_sections" ||
    value === "resume_insert_section" ||
    value === "resume_polish_text" ||
    value === "resume_set_text" ||
    value === "resume_ask" ||
    value === "get_completeness" ||
    value === "set_goal" ||
    value === "role_match_read" ||
    value === "ats_check" ||
    value === "content_claim_audit" ||
    value === "layout_fit_check" ||
    value === "section_quality_score"
  );
}

function isResumeOperationName(value: unknown): value is ResumeOperation["operation"] {
  return (
    value === "update_section" ||
    value === "delete_section" ||
    value === "reorder_sections" ||
    value === "insert_section" ||
    value === "reorder_items"
  );
}

function isAgentContextStatus(value: unknown): value is AgUiContextStatus {
  if (!isRecord(value)) return false;
  if (typeof value.effectiveInputBudgetTokens !== "number") return false;
  if (value.effectiveInputBudgetTokens < 200_000) return false;
  if (typeof value.modelInputLimitTokens !== "number") return false;
  if (typeof value.reservedOutputTokens !== "number") return false;
  if (typeof value.reservedSystemTokens !== "number") return false;
  if (typeof value.usedInputTokens !== "number") return false;
  if (typeof value.utilization !== "number") return false;
  if (!isContextStatus(value.status)) return false;
  if (!isContextPolicy(value.policy)) return false;
  if (!Array.isArray(value.sources)) return false;
  if (!value.sources.every(isContextSourceStatus)) return false;
  if (!(value.lastCompactionAt === null || typeof value.lastCompactionAt === "string")) {
    return false;
  }
  if (!Array.isArray(value.warnings)) return false;
  return value.warnings.every(isContextWarning);
}

function isContextStatus(value: unknown): value is AgUiContextStatus["status"] {
  return (
    value === "healthy" ||
    value === "near_limit" ||
    value === "compacting" ||
    value === "blocked"
  );
}

function isContextPolicy(value: unknown): value is AgUiContextStatus["policy"] {
  return (
    value === "full_context" ||
    value === "pinned_plus_recent" ||
    value === "compacted_history"
  );
}

function isContextSourceStatus(
  value: unknown,
): value is AgUiContextStatus["sources"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.tokenEstimate === "number" &&
    typeof value.included === "boolean" &&
    isContextSourceKind(value.kind) &&
    isContextSourcePriority(value.priority) &&
    isContextSourceTreatment(value.treatment)
  );
}

function isContextSourceKind(
  value: unknown,
): value is AgUiContextStatus["sources"][number]["kind"] {
  return (
    value === "system" ||
    value === "resume_snapshot" ||
    value === "workspace_facts" ||
    value === "change_sets" ||
    value === "conversation_recent" ||
    value === "conversation_summary" ||
    value === "uploaded_source" ||
    value === "tool_result" ||
    value === "retrieved_memory"
  );
}

function isContextSourcePriority(
  value: unknown,
): value is AgUiContextStatus["sources"][number]["priority"] {
  return (
    value === "required" ||
    value === "pinned" ||
    value === "working_set" ||
    value === "summarizable" ||
    value === "optional"
  );
}

function isContextSourceTreatment(
  value: unknown,
): value is AgUiContextStatus["sources"][number]["treatment"] {
  return value === "raw" || value === "summary" || value === "omitted";
}

function isContextWarning(
  value: unknown,
): value is AgUiContextStatus["warnings"][number] {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    isContextWarningCode(value.code)
  );
}

function isContextWarningCode(
  value: unknown,
): value is AgUiContextStatus["warnings"][number]["code"] {
  return (
    value === "near_limit" ||
    value === "summarized_history" ||
    value === "omitted_low_priority_context" ||
    value === "model_context_too_small" ||
    value === "token_estimate_uncertain"
  );
}

function isAgentResumeWorkspace(
  value: unknown,
): value is AgUiResumeWorkspace {
  return (
    isRecord(value) &&
    (value.resumeId === null || typeof value.resumeId === "string") &&
    isResumeSessionMode(value.mode) &&
    isResumeWorkspaceGoal(value.goal) &&
    Array.isArray(value.facts) &&
    value.facts.every(isResumeFact) &&
    (value.draftResume === null || isDraftResume(value.draftResume)) &&
    Array.isArray(value.changeSets) &&
    value.changeSets.every(isResumeChangeSet) &&
    Array.isArray(value.decisions) &&
    value.decisions.every(isUserDecision) &&
    (value.qualityReport === null || isResumeQualityReport(value.qualityReport)) &&
    typeof value.updatedAt === "string"
  );
}

function isDraftResume(
  value: unknown,
): value is NonNullable<AgUiResumeWorkspace["draftResume"]> {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    (typeof value.targetRole === "string" || value.targetRole === null) &&
    typeof value.profileSummary === "string" &&
    Array.isArray(value.sections) &&
    value.sections.every(isDraftResumeSection) &&
    Array.isArray(value.missingFacts) &&
    value.missingFacts.every((fact) => typeof fact === "string")
  );
}

function isDraftResumeSection(
  value: unknown,
): value is NonNullable<AgUiResumeWorkspace["draftResume"]>["sections"][number] {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    typeof value.summary === "string" &&
    (value.status === "drafted" || value.status === "needs_user_fact")
  );
}

function isResumeSessionMode(
  value: unknown,
): value is AgUiResumeWorkspace["mode"] {
  return value === "optimize_existing" || value === "create_from_zero";
}

function isResumeWorkspaceGoal(
  value: unknown,
): value is AgUiResumeWorkspace["goal"] {
  return (
    isRecord(value) &&
    (typeof value.workflowId === "string" || value.workflowId === null) &&
    typeof value.resumeTitle === "string" &&
    (typeof value.targetRole === "string" || value.targetRole === null) &&
    value.locale === "zh-CN"
  );
}

function isResumeFact(
  value: unknown,
): value is AgUiResumeWorkspace["facts"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sectionKey === "string" &&
    typeof value.label === "string" &&
    typeof value.text === "string" &&
    isResumeFactSource(value.source) &&
    typeof value.confidence === "number"
  );
}

function isResumeFactSource(
  value: unknown,
): value is AgUiResumeWorkspace["facts"][number]["source"] {
  return (
    value === "resume_snapshot" ||
    value === "user_answer" ||
    value === "agent_inference"
  );
}

function isResumeChangeSet(
  value: unknown,
): value is AgUiResumeWorkspace["changeSets"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    isResumeChangeSetStatus(value.status) &&
    Array.isArray(value.operationIds) &&
    value.operationIds.every((operationId) => typeof operationId === "string") &&
    Array.isArray(value.operations) &&
    value.operations.every(isResumeOperation) &&
    typeof value.createdAt === "string"
  );
}

function isResumeChangeSetStatus(
  value: unknown,
): value is AgUiResumeWorkspace["changeSets"][number]["status"] {
  return (
    value === "staged" ||
    value === "partially_applied" ||
    value === "applied" ||
    value === "rejected" ||
    value === "superseded"
  );
}

function isUserDecision(
  value: unknown,
): value is AgUiResumeWorkspace["decisions"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.changeSetId === "string" &&
    (typeof value.operationId === "string" || value.operationId === null) &&
    isUserDecisionValue(value.decision) &&
    (typeof value.note === "string" || value.note === null) &&
    typeof value.createdAt === "string"
  );
}

function isUserDecisionValue(
  value: unknown,
): value is AgUiResumeWorkspace["decisions"][number]["decision"] {
  return value === "approved" || value === "rejected" || value === "answered";
}

function isResumeQualityReport(
  value: unknown,
): value is NonNullable<AgUiResumeWorkspace["qualityReport"]> {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    typeof value.summary === "string" &&
    Array.isArray(value.risks) &&
    value.risks.every(isResumeQualityRisk)
  );
}

function isResumeQualityRisk(
  value: unknown,
): value is NonNullable<AgUiResumeWorkspace["qualityReport"]>["risks"][number] {
  return (
    isRecord(value) &&
    isResumeQualityRiskCode(value.code) &&
    typeof value.message === "string"
  );
}

function isResumeQualityRiskCode(
  value: unknown,
): value is NonNullable<
  AgUiResumeWorkspace["qualityReport"]
>["risks"][number]["code"] {
  return (
    value === "missing_fact" ||
    value === "fabrication_risk" ||
    value === "formatting_risk" ||
    value === "low_impact"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
