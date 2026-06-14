import { EventType, type BaseEvent } from "@ag-ui/core";
import { createAiSdkAgentMessageProvider } from "./providers/ai-sdk-agent-message-provider.js";
import type { AuthenticatedAgentSession } from "./auth.js";
import type { AgentErrorCode } from "./errors.js";
import {
  validateAgentToolOutput,
  isAllowedOperationFieldPath,
  type AgentToolCall,
  type ResumeOperation,
} from "./agent-tools.js";
import type { AgentContextStatusSnapshot } from "./workflows/context-status.js";
import type { AgentResumeWorkspaceSnapshot } from "./workflows/resume-workspace.js";
import {
  buildWorkflowRuntimeEvents,
  type AgentWorkflowRuntimeEvent,
} from "./workflows/workflow-runtime.js";

export type AgentWorkflowId =
  | "resume-diagnose"
  | "target-role-match"
  | "experience-star"
  | "pre-export-check"
  | "create-from-zero";

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AgentModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export type AgentQuestionRequest = {
  id: string;
  message: string;
  field?: string;
  responseSchema?: Record<string, unknown>;
};

export type AgentDraftResumeSection = {
  key: string;
  label: string;
  summary: string;
  status: "drafted" | "needs_user_fact";
};

export type AgentDraftResumeSnapshot = {
  title: string;
  targetRole: string | null;
  profileSummary: string;
  sections: AgentDraftResumeSection[];
  missingFacts: string[];
};

export type AgentResumeSessionMode = "optimize_existing" | "create_from_zero";

export type AgentSessionStatus =
  | "active"
  | "waiting_user"
  | "completed"
  | "cancelled"
  | "failed";

export type AgentWorkflowCursor = {
  workflowId: AgentWorkflowId | null;
  nodeId: string;
  loopCount: number;
  completedNodeIds: string[];
};

export type AgentSessionInterrupt = {
  id: string;
  reason: string;
  message: string | null;
  toolCallId: string | null;
  metadata: Record<string, unknown> | null;
};

export type AgentSessionSnapshot = {
  sessionId: string;
  threadId: string;
  resumeId: string | null;
  userIdHash: string;
  mode: AgentResumeSessionMode;
  status: AgentSessionStatus;
  workflow: AgentWorkflowCursor;
  workspace: AgentResumeWorkspaceSnapshot;
  contextStatus: AgentContextStatusSnapshot | null;
  pendingInterrupts: AgentSessionInterrupt[];
  lastResumeContentHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunSessionContext = {
  sessionId: string;
  threadId: string;
  resumeId: string | null;
  mode: AgentResumeSessionMode;
  workflowId: AgentWorkflowId | null;
  resumeTitle: string;
};

export type AgentMessageRequest = {
  requestId?: string;
  resumeId: string | null;
  mode?: AgentResumeSessionMode;
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  messages: AgentChatMessage[];
  modelConfig?: AgentModelConfig;
  sessionContext?: AgentRunSessionContext;
  sessionSnapshot?: AgentSessionSnapshot;
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
  } | null;
};

export type AgentMessagePrompt = {
  system: string;
  developer: string;
  user: string;
  messages?: AgentMessagePromptMessage[];
  metadata?: AgentMessagePromptMetadata;
};

export type AgentMessagePromptMessage = {
  role: "system" | "user";
  content: string;
};

export type AgentMessagePromptMetadata =
  | { source: "local" }
  | {
      source: "langfuse";
      name: string;
      label: string;
      version: number;
      isFallback: boolean;
    };

export type AgentMessageUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type AgentMessageProviderRunOptions = {
  request: AgentMessageRequest;
  prompt: AgentMessagePrompt;
  session: AuthenticatedAgentSession;
  requestId: string;
};

export type AgentMessageProviderRunResult = {
  content: string;
  usage: AgentMessageUsage;
};

export type AgentProviderStreamChunk =
  | { type: "content_delta"; delta: string }
  | { type: "usage"; usage: AgentMessageUsage };

export type AgentMessageProvider = {
  run: (
    options: AgentMessageProviderRunOptions,
  ) => Promise<AgentMessageProviderRunResult>;
  stream?: (
    options: AgentMessageProviderRunOptions,
  ) => AsyncIterable<AgentProviderStreamChunk>;
};

export const createOpenAICompatibleAgentMessageProvider =
  createAiSdkAgentMessageProvider;

export type AgentMessageParseResult =
  | {
      ok: true;
      result: {
        message: { id: string; role: "assistant"; content: string };
        toolCalls: AgentToolCall[];
        proposedOperations: ResumeOperation[];
        questions?: AgentQuestionRequest[];
        draftResume?: AgentDraftResumeSnapshot;
      };
    }
  | { ok: false; message: string };

export type ToAgUiAgentEventsInput = {
  requestId: string;
  threadId: string;
  request?: AgentMessageRequest;
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
  "create-from-zero",
]);

const MESSAGE_ROLES = new Set<AgentChatMessage["role"]>(["user", "assistant"]);
const MAX_CONTEXT_PLAIN_TEXT_LENGTH = 12_000;
const MAX_SECTION_TEXT_LENGTH = 4_000;
const MAX_MESSAGES = 20;
const AG_UI_TEXT_DELTA_CHARS = 18;

export function validateAgentMessageRequest(
  body: unknown,
): AgentMessageValidationResult {
  if (!isRecord(body)) return badRequest("Request body must be a JSON object");

  const mode = validateSessionMode(
    body.mode ?? (body.resumeId === null ? "create_from_zero" : "optimize_existing"),
  );
  if (!mode.ok) return mode;

  let resumeId: string | null;
  if (mode.value === "create_from_zero") {
    if (body.resumeId !== null) {
      return badRequest("resumeId must be null for create-from-zero");
    }
    resumeId = null;
  } else {
    const parsedResumeId = requiredString(body.resumeId, "resumeId");
    if (!parsedResumeId.ok) return parsedResumeId;
    resumeId = parsedResumeId.value;
  }

  const locale = body.locale ?? "zh-CN";
  if (locale !== "zh-CN") return badRequest("locale must be zh-CN");

  const workflowId = validateWorkflowId(
    body.workflowId ?? (mode.value === "create_from_zero" ? "create-from-zero" : null),
  );
  if (!workflowId.ok) return workflowId;

  const messages = validateMessages(body.messages);
  if (!messages.ok) return messages;
  const modelConfig = validateModelConfig(body.modelConfig);
  if (!modelConfig.ok) return modelConfig;

  let context: AgentMessageRequest["context"];
  if (mode.value === "create_from_zero") {
    if (body.context !== null) {
      return badRequest("context must be null for create-from-zero");
    }
    context = null;
  } else {
    if (!isRecord(body.context)) return badRequest("context is required");
    const parsedContext = validateContext(body.context);
    if (!parsedContext.ok) return parsedContext;
    context = parsedContext.value;
  }

  const sessionSnapshot = validateSessionSnapshot(body.sessionSnapshot, resumeId);
  if (!sessionSnapshot.ok) return sessionSnapshot;
  const sessionContext = validateSessionContext(body.sessionContext, {
    resumeId,
    mode: mode.value,
    workflowId: workflowId.value,
  });
  if (!sessionContext.ok) return sessionContext;

  return {
    ok: true,
    request: {
      resumeId,
      ...(mode.value === "create_from_zero" ? { mode: mode.value } : {}),
      locale,
      workflowId: workflowId.value,
      messages: messages.value,
      ...(modelConfig.value ? { modelConfig: modelConfig.value } : {}),
      ...(sessionContext.value
        ? { sessionContext: sessionContext.value }
        : {}),
      ...(sessionSnapshot.value
        ? { sessionSnapshot: sessionSnapshot.value }
        : {}),
      context,
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
      "输出必须是合法 JSON，不要用 Markdown 代码块包裹 JSON，不要解释推理过程。",
      "JSON schema:",
      '{"message":{"id":"string","role":"assistant","content":"string"},"toolCalls":[{"id":"string","name":"resume_read|resume_update_section|resume_delete_section|resume_reorder_sections|resume_insert_section","status":"completed","title":"string","summary":"string","input":{},"result":{}}],"proposedOperations":[{"id":"string","toolCallId":"必须等于某个 toolCalls[].id","label":"string","section":"summary|experience|projects|education|skills|research|custom","fieldPath":"string","operation":"update_section|delete_section|reorder_sections|insert_section","beforePlainText":"string","afterPlainText":"string","replacementTiptapJson":{},"sectionOrder":["string"],"changeSummary":"string","riskFlags":[{"type":"needs_user_fact|possible_fabrication|formatting_risk|unsafe_claim","message":"string"}]}],"questions":[{"id":"string","message":"string","field":"可选，例如 goal.targetRole","responseSchema":{}}],"draftResume":{"title":"string","targetRole":"string|null","profileSummary":"string","sections":[{"key":"string","label":"string","summary":"string","status":"drafted|needs_user_fact"}],"missingFacts":["string"]}}',
      "可用 tools: resume_read, resume_update_section, resume_delete_section, resume_reorder_sections, resume_insert_section",
      "即使只是追问用户、澄清选择或闲聊，也必须返回 toolCalls: [] 和 proposedOperations: []，不要省略字段。",
      "当需要用户补充事实、目标岗位或偏好时，把问题放入 questions；不要把需要回答的问题只写成普通文本。",
      "当 mode=create_from_zero 且信息足够形成初稿时，把待确认草稿放入 draftResume；草稿只能使用用户提供的信息，缺失经历必须放入 missingFacts。",
      "所有简历修改必须作为 proposedOperations 返回，不能声称已经保存。",
      "当 proposedOperations 非空时，必须同时返回对应 toolCalls；每条 proposedOperations[].toolCallId 必须引用对应 toolCalls[].id。",
      "使用 STAR 原则时，不得编造 Result 指标。",
      "原文是无序列表或有序列表时，resume_update_section 必须保持对应 TipTap 列表结构。",
      "如果缺少真实结果、指标或范围，用 riskFlags 标记 needs_user_fact。",
      `当前 workflowId=${request.workflowId ?? "none"}。`,
    ].join("\n"),
    user: buildAgentPromptUserSection(request),
  };
}

function buildAgentPromptUserSection(request: AgentMessageRequest): string {
  const lines = [
    "请基于以下 Agent Mode 请求继续对话。",
    "请求信息：",
    `- requestId: ${request.requestId ?? ""}`,
    `- workflowId: ${request.workflowId ?? ""}`,
    `- mode: ${request.mode ?? "optimize_existing"}`,
    `- locale: ${request.locale}`,
  ];

  if (!request.context) {
    lines.push(
      "- resumeTitle: 未创建",
      "- templateId: 未选择",
      "- activeSection: ",
      "",
      "最近消息：",
      ...request.messages.map(
        (message) => `- ${message.role}(${message.id}): ${message.content}`,
      ),
      "",
      "当前还没有可读取的简历快照。请先通过 questions 收集目标岗位、基础资料、经历事实和偏好，再提出可确认的简历草稿。",
    );
    return lines.join("\n");
  }

  lines.push(
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
  );

  return lines.join("\n");
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

  const toolCalls = normalizeOptionalArray(parsed.toolCalls, "toolCalls");
  if (!toolCalls.ok) return toolCalls;
  const proposedOperations = normalizeOptionalArray(
    parsed.proposedOperations,
    "proposedOperations",
  );
  if (!proposedOperations.ok) return proposedOperations;
  const questions = normalizeOptionalArray(parsed.questions, "questions");
  if (!questions.ok) return questions;
  const parsedQuestions = parseAgentQuestions(questions.value);
  if (!parsedQuestions.ok) return parsedQuestions;
  const draftResume = parseOptionalDraftResume(parsed.draftResume);
  if (!draftResume.ok && parsedQuestions.value.length === 0) return draftResume;
  const draftResumeValue = draftResume.ok ? draftResume.value : null;

  const output = validateAgentToolOutput({
    toolCalls: toolCalls.value,
    proposedOperations: proposedOperations.value,
  });
  if (!output.ok) return output;

  return {
    ok: true,
    result: {
      message: message.message,
      toolCalls: output.output.toolCalls,
      proposedOperations: output.output.proposedOperations,
      ...(parsedQuestions.value.length > 0
        ? { questions: parsedQuestions.value }
        : {}),
      ...(draftResumeValue ? { draftResume: draftResumeValue } : {}),
    },
  };
}

export function toAgUiAgentEvents({
  requestId,
  threadId,
  request,
  result,
}: ToAgUiAgentEventsInput): BaseEvent[] {
  return workflowRuntimeEventsToAgUiEvents(
    buildWorkflowRuntimeEvents({
      requestId,
      threadId,
      ...(request ? { request } : {}),
      result,
    }),
  );
}

export function workflowRuntimeEventsToAgUiEvents(
  runtimeEvents: AgentWorkflowRuntimeEvent[],
): BaseEvent[] {
  const events: BaseEvent[] = [];
  const startedTextMessageIds = new Set<string>();

  for (const runtimeEvent of runtimeEvents) {
    switch (runtimeEvent.type) {
      case "run_started":
        events.push({
          type: EventType.RUN_STARTED,
          threadId: runtimeEvent.threadId,
          runId: runtimeEvent.requestId,
        });
        break;
      case "state_snapshot":
        events.push({
          type: EventType.STATE_SNAPSHOT,
          snapshot: runtimeEvent.snapshot,
        });
        break;
      case "context_status":
        appendAgUiContextStatusEvents(events, {
          messageId: runtimeEvent.messageId,
          status: runtimeEvent.status,
        });
        break;
      case "assistant_text_delta":
        if (!startedTextMessageIds.has(runtimeEvent.messageId)) {
          events.push({
            type: EventType.TEXT_MESSAGE_START,
            messageId: runtimeEvent.messageId,
            role: "assistant",
          });
          startedTextMessageIds.add(runtimeEvent.messageId);
        }
        events.push({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: runtimeEvent.messageId,
          delta: runtimeEvent.delta,
        });
        break;
      case "tool_started":
        events.push(
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: runtimeEvent.toolCall.id,
            toolCallName: runtimeEvent.toolCall.name,
            parentMessageId: runtimeEvent.messageId,
          },
          {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: runtimeEvent.toolCall.id,
            delta: JSON.stringify(runtimeEvent.toolCall.input),
          },
          {
            type: EventType.TOOL_CALL_END,
            toolCallId: runtimeEvent.toolCall.id,
          },
        );
        break;
      case "tool_result":
        events.push({
          type: EventType.TOOL_CALL_RESULT,
          messageId: runtimeEvent.messageId,
          toolCallId: runtimeEvent.toolCall.id,
          role: "tool",
          content: JSON.stringify({
            toolCall: runtimeEvent.toolCall,
            proposedOperations: runtimeEvent.proposedOperations,
          }),
        });
        break;
      case "workspace_snapshot":
        appendAgUiResumeWorkspaceEvents(events, {
          messageId: runtimeEvent.messageId,
          workspace: runtimeEvent.workspace,
        });
        break;
      case "workflow_cursor":
        events.push({
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "replace",
              path: "/workflow",
              value: runtimeEvent.cursor,
            },
          ],
        });
        break;
      case "message_end":
        if (!startedTextMessageIds.has(runtimeEvent.messageId)) {
          events.push({
            type: EventType.TEXT_MESSAGE_START,
            messageId: runtimeEvent.messageId,
            role: "assistant",
          });
          startedTextMessageIds.add(runtimeEvent.messageId);
        }
        events.push({
          type: EventType.TEXT_MESSAGE_END,
          messageId: runtimeEvent.messageId,
        });
        break;
      case "run_finished":
        events.push({
          type: EventType.RUN_FINISHED,
          threadId: runtimeEvent.threadId,
          runId: runtimeEvent.requestId,
          outcome: runtimeEvent.outcome,
        });
        break;
    }
  }

  return events;
}

export function appendAgUiContextStatusEvents(
  events: BaseEvent[],
  {
    messageId,
    status,
  }: {
    messageId: string;
    status: AgentContextStatusSnapshot;
  },
): void {
  events.push(
    {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/contextStatus",
          value: status,
        },
      ],
    },
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId,
      activityType: "context_status",
      content: status,
      replace: true,
    },
  );
}

export function appendAgUiResumeWorkspaceEvents(
  events: BaseEvent[],
  {
    messageId,
    workspace,
  }: {
    messageId: string;
    workspace: AgentResumeWorkspaceSnapshot;
  },
): void {
  events.push(
    {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/workspace",
          value: workspace,
        },
      ],
    },
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId,
      activityType: "resume_workspace",
      content: workspace,
      replace: true,
    },
  );
}

export function createAgUiRunFinishedEvent({
  requestId,
  threadId,
  result,
}: ToAgUiAgentEventsInput): BaseEvent {
  const runId = requestId;
  const needsApproval = result.proposedOperations.length > 0;

  if (needsApproval) {
    return {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      outcome: {
        type: "interrupt",
        interrupts: result.proposedOperations.map((operation) => ({
          id: operation.id,
          reason: "approval_required",
          message: `${operation.label}: ${operation.changeSummary}`,
          toolCallId: operation.toolCallId,
          metadata: { operation },
        })),
      },
    };
  }

  return {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: { type: "success" },
  };
}

export function toAgUiAgentToolEvents({
  messageId,
  result,
}: {
  messageId: string;
  result: Extract<AgentMessageParseResult, { ok: true }>["result"];
}): BaseEvent[] {
  const events: BaseEvent[] = [];
  appendAgUiToolEvents(events, result, messageId);
  return events;
}

function appendAgUiToolEvents(
  events: BaseEvent[],
  result: Extract<AgentMessageParseResult, { ok: true }>["result"],
  messageId: string,
): void {
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
}

function normalizeOptionalArray(
  value: unknown,
  field: "toolCalls" | "proposedOperations" | "questions",
): { ok: true; value: unknown[] } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: `${field} must be an array` };
  return { ok: true, value };
}

function parseAgentQuestions(
  value: unknown[],
): { ok: true; value: AgentQuestionRequest[] } | { ok: false; message: string } {
  const questions: AgentQuestionRequest[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, message: "questions must contain objects" };
    }
    const id = requiredString(item.id, "questions.id");
    if (!id.ok) return id;
    const message = requiredString(item.message, "questions.message");
    if (!message.ok) return message;
    const field =
      typeof item.field === "string" && item.field.trim() !== ""
        ? item.field.trim()
        : undefined;
    const responseSchema =
      item.responseSchema === undefined || item.responseSchema === null
        ? undefined
        : isRecord(item.responseSchema)
          ? item.responseSchema
          : null;
    if (responseSchema === null) {
      return { ok: false, message: "questions.responseSchema must be an object" };
    }

    questions.push({
      id: id.value,
      message: message.value,
      ...(field ? { field } : {}),
      ...(responseSchema ? { responseSchema } : {}),
    });
  }

  return { ok: true, value: questions };
}

function parseOptionalDraftResume(
  value: unknown,
): { ok: true; value: AgentDraftResumeSnapshot | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isRecord(value)) return { ok: false, message: "draftResume must be an object" };

  const title = requiredString(value.title, "draftResume.title");
  if (!title.ok) return title;
  const profileSummary = requiredString(
    value.profileSummary,
    "draftResume.profileSummary",
  );
  if (!profileSummary.ok) return profileSummary;
  if (!(typeof value.targetRole === "string" || value.targetRole === null)) {
    return { ok: false, message: "draftResume.targetRole must be a string or null" };
  }
  if (!Array.isArray(value.sections)) {
    return { ok: false, message: "draftResume.sections must be an array" };
  }
  if (!Array.isArray(value.missingFacts)) {
    return { ok: false, message: "draftResume.missingFacts must be an array" };
  }

  const sections: AgentDraftResumeSection[] = [];
  for (const section of value.sections) {
    if (!isRecord(section)) {
      return { ok: false, message: "draftResume.sections must contain objects" };
    }
    const key = requiredString(section.key, "draftResume.sections.key");
    if (!key.ok) return key;
    const label = requiredString(section.label, "draftResume.sections.label");
    if (!label.ok) return label;
    const summary = requiredString(section.summary, "draftResume.sections.summary");
    if (!summary.ok) return summary;
    if (section.status !== "drafted" && section.status !== "needs_user_fact") {
      return {
        ok: false,
        message: "draftResume.sections.status must be drafted or needs_user_fact",
      };
    }
    sections.push({
      key: key.value,
      label: label.value,
      summary: summary.value,
      status: section.status,
    });
  }

  const missingFacts: string[] = [];
  for (const fact of value.missingFacts) {
    if (typeof fact !== "string") {
      return {
        ok: false,
        message: "draftResume.missingFacts must contain strings",
      };
    }
    if (fact.trim()) missingFacts.push(fact.trim());
  }

  return {
    ok: true,
    value: {
      title: title.value,
      targetRole: value.targetRole,
      profileSummary: profileSummary.value,
      sections,
      missingFacts,
    },
  };
}

function splitAgUiTextDeltas(content: string): string[] {
  const characters = Array.from(content);
  if (characters.length <= AG_UI_TEXT_DELTA_CHARS) return [content];

  const deltas: string[] = [];
  for (let index = 0; index < characters.length; index += AG_UI_TEXT_DELTA_CHARS) {
    deltas.push(characters.slice(index, index + AG_UI_TEXT_DELTA_CHARS).join(""));
  }
  return deltas;
}

export function extractStreamingAgentMessageContent(jsonText: string): string {
  const messageIndex = jsonText.indexOf('"message"');
  if (messageIndex === -1) return "";

  const contentKeyIndex = jsonText.indexOf('"content"', messageIndex);
  if (contentKeyIndex === -1) return "";

  const colonIndex = jsonText.indexOf(":", contentKeyIndex + '"content"'.length);
  if (colonIndex === -1) return "";

  let valueStart = colonIndex + 1;
  while (valueStart < jsonText.length && /\s/.test(jsonText[valueStart] ?? "")) {
    valueStart += 1;
  }
  if (jsonText[valueStart] !== '"') return "";

  return decodeJsonStringPrefix(jsonText.slice(valueStart + 1));
}

function decodeJsonStringPrefix(raw: string): string {
  let output = "";

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') return output;
    if (char !== "\\") {
      output += char;
      continue;
    }

    const escaped = raw[index + 1];
    if (!escaped) return output;
    if (escaped === '"' || escaped === "\\" || escaped === "/") {
      output += escaped;
      index += 1;
      continue;
    }
    if (escaped === "b") {
      output += "\b";
      index += 1;
      continue;
    }
    if (escaped === "f") {
      output += "\f";
      index += 1;
      continue;
    }
    if (escaped === "n") {
      output += "\n";
      index += 1;
      continue;
    }
    if (escaped === "r") {
      output += "\r";
      index += 1;
      continue;
    }
    if (escaped === "t") {
      output += "\t";
      index += 1;
      continue;
    }
    if (escaped === "u") {
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return output;
      output += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
    }
  }

  return output;
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

function validateSessionMode(
  value: unknown,
):
  | { ok: true; value: AgentResumeSessionMode }
  | AgentMessageValidationFailure {
  if (value === "optimize_existing" || value === "create_from_zero") {
    return { ok: true, value };
  }
  return badRequest("mode is not supported");
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

function validateModelConfig(
  value: unknown,
):
  | { ok: true; value: AgentModelConfig | undefined }
  | AgentMessageValidationFailure {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) return badRequest("modelConfig must be an object");

  const baseUrl = requiredString(value.baseUrl, "modelConfig.baseUrl");
  if (!baseUrl.ok) return baseUrl;
  if (!isSafeModelBaseUrl(baseUrl.value)) {
    return badRequest("modelConfig.baseUrl is not allowed");
  }
  const apiKey = requiredString(value.apiKey, "modelConfig.apiKey");
  if (!apiKey.ok) return apiKey;
  const modelName = requiredString(value.modelName, "modelConfig.modelName");
  if (!modelName.ok) return modelName;

  return {
    ok: true,
    value: {
      baseUrl: baseUrl.value,
      apiKey: apiKey.value,
      modelName: modelName.value,
    },
  };
}

function isSafeModelBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) return false;
  if (isBlockedModelHostname(hostname)) return false;

  const ipv4 = parseIpv4(hostname) ?? parseIpv4MappedIpv6(hostname);
  if (ipv4 && isBlockedIpv4(ipv4)) return false;
  if (isBlockedIpv6(hostname)) return false;

  return true;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isBlockedModelHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata" ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata.internal" ||
    hostname === "instance-data" ||
    hostname.endsWith(".internal")
  );
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255
      ? value
      : Number.NaN;
  });

  return octets.every(Number.isFinite) ? octets : null;
}

function parseIpv4MappedIpv6(hostname: string): number[] | null {
  const normalized = hostname.toLowerCase();
  const marker = "::ffff:";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;

  const mapped = normalized.slice(markerIndex + marker.length);
  if (mapped.includes(".")) return parseIpv4(mapped);

  const words = mapped.split(":");
  if (words.length !== 2) return null;
  const [high, low] = words.map(parseIpv6Word);
  if (high === null || low === null) return null;

  return [high >> 8, high & 255, low >> 8, low & 255];
}

function parseIpv6Word(value: string): number | null {
  if (!/^[0-9a-f]{1,4}$/.test(value)) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffff
    ? parsed
    : null;
}

function isBlockedIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized === "fd00:ec2::254"
  );
}

function validateSessionSnapshot(
  value: unknown,
  requestResumeId: string | null,
):
  | { ok: true; value: AgentSessionSnapshot | undefined }
  | AgentMessageValidationFailure {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!isAgentSessionSnapshot(value)) {
    return badRequest("sessionSnapshot is invalid");
  }
  if (value.resumeId !== requestResumeId) {
    return badRequest("sessionSnapshot is invalid");
  }
  if (value.workspace.resumeId !== requestResumeId) {
    return badRequest("sessionSnapshot is invalid");
  }
  return { ok: true, value };
}

function validateSessionContext(
  value: unknown,
  expected: {
    resumeId: string | null;
    mode: AgentResumeSessionMode;
    workflowId: AgentWorkflowId | null;
  },
):
  | { ok: true; value: AgentRunSessionContext | undefined }
  | AgentMessageValidationFailure {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) return badRequest("sessionContext is invalid");

  const sessionId = requiredString(value.sessionId, "sessionContext.sessionId");
  if (!sessionId.ok) return sessionId;
  const threadId = requiredString(value.threadId, "sessionContext.threadId");
  if (!threadId.ok) return threadId;
  const resumeTitle = requiredString(
    value.resumeTitle,
    "sessionContext.resumeTitle",
  );
  if (!resumeTitle.ok) return resumeTitle;
  const mode = validateSessionMode(value.mode);
  if (!mode.ok) return mode;
  const workflowId = validateWorkflowId(value.workflowId);
  if (!workflowId.ok) return workflowId;

  const resumeId =
    value.resumeId === null
      ? null
      : typeof value.resumeId === "string" && value.resumeId.trim() !== ""
        ? value.resumeId.trim()
        : undefined;
  if (resumeId === undefined) return badRequest("sessionContext.resumeId is invalid");
  if (resumeId !== expected.resumeId) return badRequest("sessionContext is invalid");
  if (mode.value !== expected.mode) return badRequest("sessionContext is invalid");
  if (workflowId.value !== expected.workflowId) {
    return badRequest("sessionContext is invalid");
  }

  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      threadId: threadId.value,
      resumeId,
      mode: mode.value,
      workflowId: workflowId.value,
      resumeTitle: resumeTitle.value,
    },
  };
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

  const sections: NonNullable<AgentMessageRequest["context"]>["sections"] = [];
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
  | {
      ok: true;
      value: NonNullable<AgentMessageRequest["context"]>["completeness"];
    }
  | AgentMessageValidationFailure {
  if (!isFiniteNumber(completeness.overall)) {
    return badRequest("context.completeness.overall is required");
  }
  if (!Array.isArray(completeness.sections)) {
    return badRequest("context.completeness.sections is required");
  }

  const sections: NonNullable<
    AgentMessageRequest["context"]
  >["completeness"]["sections"] = [];
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

function isAgentSessionSnapshot(value: unknown): value is AgentSessionSnapshot {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.threadId === "string" &&
    (value.resumeId === null || typeof value.resumeId === "string") &&
    typeof value.userIdHash === "string" &&
    isAgentResumeSessionMode(value.mode) &&
    isAgentSessionStatus(value.status) &&
    isWorkflowCursor(value.workflow) &&
    isResumeWorkspaceSnapshot(value.workspace) &&
    (value.contextStatus === null || isContextStatusSnapshot(value.contextStatus)) &&
    Array.isArray(value.pendingInterrupts) &&
    value.pendingInterrupts.every(isSessionInterruptSnapshot) &&
    (value.lastResumeContentHash === null ||
      typeof value.lastResumeContentHash === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isWorkflowCursor(value: unknown): value is AgentWorkflowCursor {
  return (
    isRecord(value) &&
    (value.workflowId === null ||
      value.workflowId === "create-from-zero" ||
      WORKFLOW_IDS.has(value.workflowId as AgentWorkflowId)) &&
    typeof value.nodeId === "string" &&
    isFiniteNumber(value.loopCount) &&
    Array.isArray(value.completedNodeIds) &&
    value.completedNodeIds.every((nodeId) => typeof nodeId === "string")
  );
}

function isResumeWorkspaceSnapshot(
  value: unknown,
): value is AgentResumeWorkspaceSnapshot {
  return (
    isRecord(value) &&
    (value.resumeId === null || typeof value.resumeId === "string") &&
    isAgentResumeSessionMode(value.mode) &&
    isRecord(value.goal) &&
    (value.goal.workflowId === null ||
      typeof value.goal.workflowId === "string") &&
    typeof value.goal.resumeTitle === "string" &&
    (value.goal.targetRole === null ||
      typeof value.goal.targetRole === "string") &&
    value.goal.locale === "zh-CN" &&
    Array.isArray(value.facts) &&
    Array.isArray(value.changeSets) &&
    Array.isArray(value.decisions) &&
    (value.qualityReport === null || isRecord(value.qualityReport)) &&
    typeof value.updatedAt === "string"
  );
}

function isContextStatusSnapshot(
  value: unknown,
): value is AgentContextStatusSnapshot {
  return (
    isRecord(value) &&
    isFiniteNumber(value.effectiveInputBudgetTokens) &&
    value.effectiveInputBudgetTokens >= 200_000 &&
    isFiniteNumber(value.modelInputLimitTokens) &&
    isFiniteNumber(value.reservedOutputTokens) &&
    isFiniteNumber(value.reservedSystemTokens) &&
    isFiniteNumber(value.usedInputTokens) &&
    isFiniteNumber(value.utilization) &&
    (value.status === "healthy" ||
      value.status === "near_limit" ||
      value.status === "compacting" ||
      value.status === "blocked") &&
    (value.policy === "full_context" ||
      value.policy === "pinned_plus_recent" ||
      value.policy === "compacted_history") &&
    Array.isArray(value.sources) &&
    Array.isArray(value.warnings) &&
    (value.lastCompactionAt === null ||
      typeof value.lastCompactionAt === "string")
  );
}

function isSessionInterruptSnapshot(
  value: unknown,
): value is AgentSessionInterrupt {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.reason === "string" &&
    (value.message === null || typeof value.message === "string") &&
    (value.toolCallId === null || typeof value.toolCallId === "string") &&
    (value.metadata === null || isRecord(value.metadata))
  );
}

function isAgentResumeSessionMode(
  value: unknown,
): value is AgentResumeSessionMode {
  return value === "optimize_existing" || value === "create_from_zero";
}

function isAgentSessionStatus(value: unknown): value is AgentSessionStatus {
  return (
    value === "active" ||
    value === "waiting_user" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "failed"
  );
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
