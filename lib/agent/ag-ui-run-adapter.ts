import type { Message, RunAgentInput } from "@ag-ui/core";

import type {
  AgentChatMessage,
  AgentMessageRequest,
  AgentResumeContext,
  AgentWorkflowId,
} from "@/lib/agent/agent-message-contract";

export type AgUiRunAdapterResult =
  | { ok: true; request: AgentMessageRequest }
  | { ok: false; message: string };

const WORKFLOW_IDS = new Set<AgentWorkflowId>([
  "resume-diagnose",
  "target-role-match",
  "experience-star",
  "pre-export-check",
]);

export function mapAgUiRunToAgentMessageRequest(
  input: RunAgentInput,
): AgUiRunAdapterResult {
  const introBuilder = getIntroBuilderForwardedProps(input.forwardedProps);
  if (!introBuilder) {
    return { ok: false, message: "forwardedProps.introBuilder is required" };
  }

  if (!isNonEmptyString(introBuilder.resumeId)) {
    return { ok: false, message: "resumeId is required" };
  }
  if (introBuilder.locale !== "zh-CN") {
    return { ok: false, message: "locale must be zh-CN" };
  }
  if (!isSupportedWorkflowId(introBuilder.workflowId)) {
    return { ok: false, message: "workflowId is not supported" };
  }
  if (!isAgentResumeContext(introBuilder.context)) {
    return { ok: false, message: "context is invalid" };
  }

  const messages = input.messages
    .map(toAgentChatMessage)
    .filter((message): message is AgentChatMessage => message !== null);
  if (messages.length === 0) {
    return { ok: false, message: "messages must not be empty" };
  }

  // Handle interrupt resume: inject approval feedback as system message
  if (input.resume && Array.isArray(input.resume) && input.resume.length > 0) {
    const feedbackMessage = buildApprovalFeedbackMessage(input.resume);
    messages.push({
      id: `system_approval_${Date.now()}`,
      role: "assistant",
      content: feedbackMessage,
    });
  }

  return {
    ok: true,
    request: {
      resumeId: introBuilder.resumeId,
      locale: "zh-CN",
      workflowId: introBuilder.workflowId,
      messages,
      context: introBuilder.context,
    },
  };
}

function buildApprovalFeedbackMessage(
  resume: Array<{
    interruptId: string;
    status: "resolved" | "cancelled";
    payload?: unknown;
  }>,
): string {
  const approved = resume.filter(
    (entry) => entry.status === "resolved" && isApprovedPayload(entry.payload),
  );
  const rejected = resume.filter(
    (entry) =>
      entry.status === "cancelled" ||
      (entry.status === "resolved" && !isApprovedPayload(entry.payload)),
  );

  const parts: string[] = ["用户已审核你的修改建议："];

  if (approved.length > 0) {
    parts.push(
      `✓ 已批准并应用：${approved.map((e) => e.interruptId).join(", ")}`,
    );
  }

  if (rejected.length > 0) {
    parts.push(`✗ 已拒绝：${rejected.map((e) => e.interruptId).join(", ")}`);
  }

  parts.push(
    "请基于用户的选择继续对话。被拒绝的建议不要重复提及，已应用的建议可以进一步优化。",
  );

  return parts.join("\n");
}

function isApprovedPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.approved === true;
}

function getIntroBuilderForwardedProps(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.introBuilder)) return value.introBuilder;
  if (isRecord(value.runConfig) && isRecord(value.runConfig.introBuilder)) {
    return value.runConfig.introBuilder;
  }
  return null;
}

function toAgentChatMessage(message: Message): AgentChatMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;

  const content = readMessageContent(message.content);
  if (!content) return null;

  return {
    id: message.id,
    role: message.role,
    content,
  };
}

function readMessageContent(content: Message["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("")
    .trim();
}

function isSupportedWorkflowId(value: unknown): value is AgentWorkflowId | null {
  return (
    value === null ||
    (typeof value === "string" && WORKFLOW_IDS.has(value as AgentWorkflowId))
  );
}

function isAgentResumeContext(value: unknown): value is AgentResumeContext {
  if (!isRecord(value)) return false;
  if (typeof value.resumeTitle !== "string") return false;
  if (!isNonEmptyString(value.templateId)) return false;
  if (!(value.activeSection === null || typeof value.activeSection === "string")) {
    return false;
  }
  if (!isRecord(value.completeness)) return false;
  if (typeof value.completeness.overall !== "number") return false;
  if (!Array.isArray(value.completeness.sections)) return false;
  if (!Array.isArray(value.sections)) return false;

  return (
    value.completeness.sections.every(isCompletenessSection) &&
    value.sections.every(isAgentContextSection)
  );
}

function isCompletenessSection(value: unknown): value is {
  key: string;
  label: string;
  score: number;
  max: number;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    typeof value.score === "number" &&
    typeof value.max === "number"
  );
}

function isAgentContextSection(value: unknown): value is {
  key: string;
  label: string;
  fieldPath: string;
  plainText: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.fieldPath) &&
    typeof value.plainText === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
