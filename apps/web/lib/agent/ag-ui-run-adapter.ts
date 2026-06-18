import type { Message, RunAgentInput } from "@ag-ui/core";

import type {
  AgentChatMessage,
  AgentMessageRequest,
  AgentModelConfig,
  AgentResumeContext,
  AgentResumeSessionMode,
  AgentWorkflowId,
} from "@intro-builder/shared/types";

export type AgUiRunAdapterResult =
  | { ok: true; request: AgentMessageRequest }
  | { ok: false; message: string };

const WORKFLOW_IDS = new Set<AgentWorkflowId>([
  "resume-diagnose",
  "target-role-match",
  "experience-star",
  "pre-export-check",
  "create-from-zero",
]);

export function mapAgUiRunToAgentMessageRequest(
  input: RunAgentInput,
): AgUiRunAdapterResult {
  const introBuilder = getIntroBuilderForwardedProps(input.forwardedProps);
  if (!introBuilder) {
    return { ok: false, message: "forwardedProps.introBuilder is required" };
  }

  const mode = readAgentSessionMode(
    introBuilder.mode ??
      (introBuilder.resumeId === null ? "create_from_zero" : "optimize_existing"),
  );
  if (!mode) return { ok: false, message: "mode is not supported" };

  if (introBuilder.locale !== "zh-CN") {
    return { ok: false, message: "locale must be zh-CN" };
  }

  const workflowId =
    introBuilder.workflowId ??
    (mode === "create_from_zero" ? "create-from-zero" : null);
  if (!isSupportedWorkflowId(workflowId)) {
    return { ok: false, message: "workflowId is not supported" };
  }

  let resumeId: string | null;
  let context: AgentResumeContext | null;
  if (mode === "create_from_zero") {
    if (introBuilder.resumeId !== null) {
      return { ok: false, message: "resumeId must be null for create-from-zero" };
    }
    if (introBuilder.context !== null) {
      return { ok: false, message: "context must be null for create-from-zero" };
    }
    resumeId = null;
    context = null;
  } else {
    if (!isNonEmptyString(introBuilder.resumeId)) {
      return { ok: false, message: "resumeId is required" };
    }
    if (!isAgentResumeContext(introBuilder.context)) {
      return { ok: false, message: "context is invalid" };
    }
    resumeId = introBuilder.resumeId;
    context = introBuilder.context;
  }

  const messages = input.messages
    .map(toAgentChatMessage)
    .filter((message): message is AgentChatMessage => message !== null);
  if (messages.length === 0) {
    return { ok: false, message: "messages must not be empty" };
  }

  // Handle interrupt resume: inject human feedback as the next Agent context.
  if (input.resume && Array.isArray(input.resume) && input.resume.length > 0) {
    const feedbackMessage = buildInterruptFeedbackMessage(input.resume);
    messages.push({
      id: `system_interrupt_${Date.now()}`,
      role: "assistant",
      content: feedbackMessage,
    });
  }

  const modelConfig = readAgentModelConfig(introBuilder.modelConfig);

  return {
    ok: true,
    request: {
      resumeId,
      ...(mode === "create_from_zero" ? { mode } : {}),
      locale: "zh-CN",
      workflowId,
      messages,
      context,
      ...(modelConfig ? { modelConfig } : {}),
    },
  };
}

function readAgentSessionMode(value: unknown): AgentResumeSessionMode | null {
  if (value === "optimize_existing" || value === "create_from_zero") return value;
  return null;
}

function readAgentModelConfig(value: unknown): AgentModelConfig | null {
  if (!isRecord(value)) return null;
  const baseUrl = readNonEmptyString(value.baseUrl);
  const apiKey = readNonEmptyString(value.apiKey);
  const modelName = readNonEmptyString(value.modelName);
  if (!baseUrl || !apiKey || !modelName) return null;
  return { baseUrl, apiKey, modelName };
}

function buildInterruptFeedbackMessage(
  resume: Array<{
    interruptId: string;
    status: "resolved" | "cancelled";
    payload?: unknown;
  }>,
): string {
  const answered = resume.filter(
    (entry) => entry.status === "resolved" && isAnswerPayload(entry.payload),
  );
  const approvalEntries = resume.filter((entry) => !isAnswerPayload(entry.payload));
  const approved = approvalEntries.filter(
    (entry) => entry.status === "resolved" && isApprovedPayload(entry.payload),
  );
  const rejected = approvalEntries.filter(
    (entry) =>
      entry.status === "cancelled" ||
      (entry.status === "resolved" && !isApprovedPayload(entry.payload)),
  );

  const parts: string[] = [];

  if (answered.length > 0) {
    parts.push("用户已补充 Agent 需要的信息：");
    parts.push(
      ...answered.map(
        (entry) => `${entry.interruptId}：${readAnswerPayload(entry.payload)}`,
      ),
    );
  }

  if (approved.length > 0 || rejected.length > 0) {
    parts.push("用户已审核你的修改建议：");
  }

  if (approved.length > 0) {
    parts.push(
      `✓ 已批准并应用：${approved.map((e) => e.interruptId).join(", ")}`,
    );
  }

  if (rejected.length > 0) {
    parts.push(`✗ 已拒绝：${rejected.map((e) => e.interruptId).join(", ")}`);
  }

  if (answered.length > 0 && approved.length === 0 && rejected.length === 0) {
    parts.push("请基于用户补充的信息继续当前任务。");
  } else {
    parts.push(
      "请基于用户的选择继续对话。被拒绝的建议不要重复提及，已应用的建议可以进一步优化。",
    );
  }

  return parts.join("\n");
}

function isApprovedPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.approved === true;
}

function isAnswerPayload(payload: unknown): payload is { answer: string } {
  return isRecord(payload) && typeof payload.answer === "string";
}

function readAnswerPayload(payload: unknown): string {
  if (!isAnswerPayload(payload)) return "";
  return payload.answer.trim();
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
  if (
    value.sectionOrder !== undefined &&
    (!Array.isArray(value.sectionOrder) ||
      !value.sectionOrder.every(isNonEmptyString))
  ) {
    return false;
  }
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

function readNonEmptyString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
