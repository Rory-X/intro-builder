import { EventType, type BaseEvent } from "@ag-ui/core";
import type { AuthenticatedAgentSession } from "./auth.js";
import type { AgentConfig } from "./config.js";
import type { AgentErrorCode } from "./errors.js";
import {
  validateAgentToolOutput,
  isAllowedOperationFieldPath,
  type AgentToolCall,
  type ResumeOperation,
} from "./agent-tools.js";
import { RichTextPolishProviderError } from "./rich-text-polish.js";

export type AgentWorkflowId =
  | "resume-diagnose"
  | "target-role-match"
  | "experience-star"
  | "pre-export-check";

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AgentMessageRequest = {
  requestId?: string;
  resumeId: string;
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  messages: AgentChatMessage[];
  context: {
    resumeTitle: string;
    templateId: string;
    activeSection: string | null;
    completeness: {
      overall: number;
      sections: Array<{ key: string; label: string; score: number; max: number }>;
    };
    sections: Array<{
      key: string;
      label: string;
      fieldPath: string;
      plainText: string;
    }>;
  };
};

export type AgentMessagePrompt = {
  system: string;
  developer: string;
  user: string;
};

export type AgentMessageUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type AgentMessageProvider = {
  run: (options: {
    request: AgentMessageRequest;
    prompt: AgentMessagePrompt;
    session: AuthenticatedAgentSession;
    requestId: string;
  }) => Promise<{ content: string; usage: AgentMessageUsage }>;
};

export type AgentMessageParseResult =
  | {
      ok: true;
      result: {
        message: { id: string; role: "assistant"; content: string };
        toolCalls: AgentToolCall[];
        proposedOperations: ResumeOperation[];
      };
    }
  | { ok: false; message: string };

export type ToAgUiAgentEventsInput = {
  requestId: string;
  threadId: string;
  result: Extract<AgentMessageParseResult, { ok: true }>["result"];
};

export type AgentMessageValidationResult =
  | { ok: true; request: AgentMessageRequest }
  | {
      ok: false;
      statusCode: 400 | 413;
      error: Extract<AgentErrorCode, "bad_request" | "payload_too_large">;
      message: string;
    };

type AgentMessageValidationFailure = Extract<
  AgentMessageValidationResult,
  { ok: false }
>;

type RequiredStringResult =
  | { ok: true; value: string }
  | AgentMessageValidationFailure;

const WORKFLOW_IDS = new Set<AgentWorkflowId>([
  "resume-diagnose",
  "target-role-match",
  "experience-star",
  "pre-export-check",
]);

const MESSAGE_ROLES = new Set<AgentChatMessage["role"]>(["user", "assistant"]);
const MAX_CONTEXT_PLAIN_TEXT_LENGTH = 12_000;
const MAX_SECTION_TEXT_LENGTH = 4_000;
const MAX_MESSAGES = 20;

export function validateAgentMessageRequest(
  body: unknown,
): AgentMessageValidationResult {
  if (!isRecord(body)) return badRequest("Request body must be a JSON object");

  const resumeId = requiredString(body.resumeId, "resumeId");
  if (!resumeId.ok) return resumeId;

  const locale = body.locale ?? "zh-CN";
  if (locale !== "zh-CN") return badRequest("locale must be zh-CN");

  const workflowId = validateWorkflowId(body.workflowId ?? null);
  if (!workflowId.ok) return workflowId;

  const messages = validateMessages(body.messages);
  if (!messages.ok) return messages;

  if (!isRecord(body.context)) return badRequest("context is required");
  const context = validateContext(body.context);
  if (!context.ok) return context;

  return {
    ok: true,
    request: {
      resumeId: resumeId.value,
      locale,
      workflowId: workflowId.value,
      messages: messages.value,
      context: context.value,
    },
  };
}

export function buildAgentMessagePrompt(
  request: AgentMessageRequest,
): AgentMessagePrompt {
  return {
    system: [
      "你是 intro-builder 的简历 Agent。",
      "你帮助中文互联网求职者诊断和优化简历，但你不能直接保存简历。",
      "你只能基于 Web 提供的当前简历快照工作，不得编造事实、数字、公司、学校、职位、技术栈、奖项或结果。",
      "当信息不足时，先提出需要用户补充的事实。",
    ].join("\n"),
    developer: [
      "输出必须是合法 JSON，不要 Markdown，不要解释推理过程。",
      "JSON schema:",
      '{"message":{"id":"string","role":"assistant","content":"string"},"toolCalls":[{"id":"string","name":"resume_read|resume_update_section|resume_delete_section|resume_reorder_sections|resume_insert_section","status":"completed","title":"string","summary":"string","input":{},"result":{}}],"proposedOperations":[]}',
      "可用 tools: resume_read, resume_update_section, resume_delete_section, resume_reorder_sections, resume_insert_section",
      "所有简历修改必须作为 proposedOperations 返回，不能声称已经保存。",
      "使用 STAR 原则时，不得编造 Result 指标。",
      "原文是无序列表或有序列表时，resume_update_section 必须保持对应 TipTap 列表结构。",
      "如果缺少真实结果、指标或范围，用 riskFlags 标记 needs_user_fact。",
      `当前 workflowId=${request.workflowId ?? "none"}。`,
    ].join("\n"),
    user: [
      "请基于以下 Agent Mode 请求继续对话。",
      "请求信息：",
      `- requestId: ${request.requestId ?? ""}`,
      `- workflowId: ${request.workflowId ?? ""}`,
      `- locale: ${request.locale}`,
      `- resumeTitle: ${request.context.resumeTitle}`,
      `- templateId: ${request.context.templateId}`,
      `- activeSection: ${request.context.activeSection ?? ""}`,
      "",
      "最近消息：",
      ...request.messages.map(
        (message) => `- ${message.role}(${message.id}): ${message.content}`,
      ),
      "",
      "完成度：",
      `- overall: ${request.context.completeness.overall}`,
      ...request.context.completeness.sections.map(
        (section) =>
          `- ${section.key} (${section.label}): ${section.score}/${section.max}`,
      ),
      "",
      "简历文本片段：",
      ...request.context.sections.map(
        (section) =>
          `## ${section.key} (${section.label}) fieldPath=${section.fieldPath}\n${section.plainText}`,
      ),
    ].join("\n"),
  };
}

export function parseAgentMessageProviderResponse(
  content: string,
): AgentMessageParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, message: "Provider returned invalid JSON" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, message: "Provider response must be a JSON object" };
  }
  if (!isRecord(parsed.message)) {
    return { ok: false, message: "Provider response missing message" };
  }
  const message = parseAssistantMessage(parsed.message);
  if (!message.ok) return message;

  const output = validateAgentToolOutput({
    toolCalls: parsed.toolCalls,
    proposedOperations: parsed.proposedOperations,
  });
  if (!output.ok) return output;

  return {
    ok: true,
    result: {
      message: message.message,
      toolCalls: output.output.toolCalls,
      proposedOperations: output.output.proposedOperations,
    },
  };
}

export function toAgUiAgentEvents({
  requestId,
  threadId,
  result,
}: ToAgUiAgentEventsInput): BaseEvent[] {
  const runId = requestId;
  const messageId = result.message.id;
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId, runId },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: result.message.content,
    },
  ];

  for (const toolCall of result.toolCalls) {
    const operations = result.proposedOperations.filter(
      (operation) => operation.toolCallId === toolCall.id,
    );
    events.push(
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: toolCall.id,
        toolCallName: toolCall.name,
        parentMessageId: messageId,
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: toolCall.id,
        delta: JSON.stringify(toolCall.input),
      },
      {
        type: EventType.TOOL_CALL_END,
        toolCallId: toolCall.id,
      },
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: `${toolCall.id}_result`,
        toolCallId: toolCall.id,
        role: "tool",
        content: JSON.stringify({
          toolCall,
          proposedOperations: operations,
        }),
      },
    );
  }

  events.push(
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      outcome: { type: "success" },
    },
  );

  return events;
}

export function createOpenAICompatibleAgentMessageProvider(
  config: AgentConfig,
  fetchFn: typeof fetch = fetch,
): AgentMessageProvider | undefined {
  if (!config.modelBaseUrl || !config.modelApiKey || !config.modelName) {
    return undefined;
  }

  return {
    async run({ prompt }) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.modelTimeoutMs,
      );
      try {
        const response = await fetchFn(
          joinUrl(config.modelBaseUrl!, "/chat/completions"),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.modelApiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: config.modelName,
              response_format: { type: "json_object" },
              thinking: { type: "disabled" },
              messages: [
                {
                  role: "system",
                  content: `${prompt.system}\n\n开发者指令：\n${prompt.developer}`,
                },
                { role: "user", content: prompt.user },
              ],
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new RichTextPolishProviderError(
            `Provider request failed with ${response.status}`,
            "dependency_unavailable",
          );
        }
        const body = await response.json();
        const providerContent = extractOpenAICompatibleContent(body);
        if (!providerContent) {
          throw new RichTextPolishProviderError(
            "Provider response missing message content",
            "dependency_unavailable",
          );
        }
        const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
        return {
          content: providerContent,
          usage: {
            provider: "openai-compatible",
            model: config.modelName!,
            inputTokens: numberOrZero(usage.prompt_tokens),
            outputTokens: numberOrZero(usage.completion_tokens),
          },
        };
      } catch (error) {
        if (error instanceof RichTextPolishProviderError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new RichTextPolishProviderError(
            "Provider request timed out",
            "provider_timeout",
          );
        }
        throw new RichTextPolishProviderError(
          error instanceof Error ? error.message : "Provider request failed",
          "dependency_unavailable",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function validateWorkflowId(
  value: unknown,
):
  | { ok: true; value: AgentWorkflowId | null }
  | AgentMessageValidationFailure {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || !WORKFLOW_IDS.has(value as AgentWorkflowId)) {
    return badRequest("workflowId is not supported");
  }
  return { ok: true, value: value as AgentWorkflowId };
}

function validateMessages(
  value: unknown,
):
  | { ok: true; value: AgentChatMessage[] }
  | AgentMessageValidationFailure {
  if (!Array.isArray(value) || value.length === 0) {
    return badRequest("messages must not be empty");
  }
  if (value.length > MAX_MESSAGES) {
    return badRequest(`messages must be at most ${MAX_MESSAGES}`);
  }

  const messages: AgentChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) return badRequest("messages must be valid");
    const id = requiredString(item.id, "messages.id");
    if (!id.ok) return id;
    if (
      typeof item.role !== "string" ||
      !MESSAGE_ROLES.has(item.role as AgentChatMessage["role"])
    ) {
      return badRequest("messages.role is invalid");
    }
    const content = requiredString(item.content, "messages.content");
    if (!content.ok) return content;
    messages.push({
      id: id.value,
      role: item.role as AgentChatMessage["role"],
      content: content.value,
    });
  }

  return { ok: true, value: messages };
}

function validateContext(
  context: Record<string, unknown>,
):
  | { ok: true; value: AgentMessageRequest["context"] }
  | AgentMessageValidationFailure {
  const resumeTitle =
    typeof context.resumeTitle === "string" && context.resumeTitle.trim() !== ""
      ? context.resumeTitle.trim()
      : "未填写目标岗位";
  const templateId = requiredString(context.templateId, "context.templateId");
  if (!templateId.ok) return templateId;
  const activeSection =
    typeof context.activeSection === "string" && context.activeSection.trim() !== ""
      ? context.activeSection.trim()
      : null;

  if (!isRecord(context.completeness)) {
    return badRequest("context.completeness is required");
  }
  const completeness = parseCompleteness(context.completeness);
  if (!completeness.ok) return completeness;

  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    return badRequest("context.sections must not be empty");
  }

  const sections: AgentMessageRequest["context"]["sections"] = [];
  let totalPlainTextLength = 0;
  for (const section of context.sections) {
    if (!isRecord(section)) return badRequest("context.sections must be valid");
    const key = requiredString(section.key, "context.sections.key");
    if (!key.ok) return key;
    const label = requiredString(section.label, "context.sections.label");
    if (!label.ok) return label;
    const fieldPath = requiredString(
      section.fieldPath,
      "context.sections.fieldPath",
    );
    if (!fieldPath.ok) return fieldPath;
    if (!isAllowedOperationFieldPath(fieldPath.value)) {
      return badRequest("context.sections.fieldPath is not allowed");
    }
    const plainText = requiredString(
      section.plainText,
      "context.sections.plainText",
    );
    if (!plainText.ok) return plainText;
    totalPlainTextLength += plainText.value.length;
    if (totalPlainTextLength > MAX_CONTEXT_PLAIN_TEXT_LENGTH) {
      return {
        ok: false,
        statusCode: 413,
        error: "payload_too_large",
        message: `context plain text must be at most ${MAX_CONTEXT_PLAIN_TEXT_LENGTH} characters`,
      };
    }
    if (plainText.value.length > MAX_SECTION_TEXT_LENGTH) {
      return {
        ok: false,
        statusCode: 413,
        error: "payload_too_large",
        message: `context.sections.plainText must be at most ${MAX_SECTION_TEXT_LENGTH} characters`,
      };
    }
    sections.push({
      key: key.value,
      label: label.value,
      fieldPath: fieldPath.value,
      plainText: plainText.value,
    });
  }

  return {
    ok: true,
    value: {
      resumeTitle,
      templateId: templateId.value,
      activeSection,
      completeness: completeness.value,
      sections,
    },
  };
}

function parseCompleteness(
  completeness: Record<string, unknown>,
):
  | { ok: true; value: AgentMessageRequest["context"]["completeness"] }
  | AgentMessageValidationFailure {
  if (!isFiniteNumber(completeness.overall)) {
    return badRequest("context.completeness.overall is required");
  }
  if (!Array.isArray(completeness.sections)) {
    return badRequest("context.completeness.sections is required");
  }

  const sections: AgentMessageRequest["context"]["completeness"]["sections"] =
    [];
  for (const section of completeness.sections) {
    if (!isRecord(section)) {
      return badRequest("context.completeness.sections must be valid");
    }
    const key = requiredString(section.key, "context.completeness.sections.key");
    if (!key.ok) return key;
    const label = requiredString(
      section.label,
      "context.completeness.sections.label",
    );
    if (!label.ok) return label;
    if (!isFiniteNumber(section.score) || !isFiniteNumber(section.max)) {
      return badRequest("context.completeness.sections score and max are required");
    }
    sections.push({
      key: key.value,
      label: label.value,
      score: section.score,
      max: section.max,
    });
  }

  return {
    ok: true,
    value: {
      overall: completeness.overall,
      sections,
    },
  };
}

function parseAssistantMessage(
  value: Record<string, unknown>,
):
  | { ok: true; message: { id: string; role: "assistant"; content: string } }
  | { ok: false; message: string } {
  const id = parseRequiredString(value.id, "Provider message missing id");
  if (!id.ok) return id;
  if (value.role !== "assistant") {
    return { ok: false, message: "Provider message role must be assistant" };
  }
  const content = parseRequiredString(
    value.content,
    "Provider message missing content",
  );
  if (!content.ok) return content;

  return {
    ok: true,
    message: {
      id: id.value,
      role: "assistant",
      content: content.value,
    },
  };
}

function requiredString(
  value: unknown,
  field: string,
): RequiredStringResult {
  if (typeof value !== "string" || value.trim() === "") {
    return badRequest(`${field} is required`);
  }
  return { ok: true, value: value.trim() };
}

function parseRequiredString(
  value: unknown,
  message: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, message };
  }
  return { ok: true, value: value.trim() };
}

function badRequest(message: string): AgentMessageValidationFailure {
  return {
    ok: false,
    statusCode: 400,
    error: "bad_request",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function extractOpenAICompatibleContent(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;
  const [choice] = body.choices;
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return typeof choice.message.content === "string" ? choice.message.content : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
