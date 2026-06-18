import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { currentUserId } from "@/lib/auth-helpers";
import {
  appendFloatingChatMessage,
  getFloatingChatSession,
  renameFloatingChatSession,
} from "@/lib/agent/floating-chat-session-store";
import type { AgentModelConfig, ResumeOperation } from "@intro-builder/shared/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FloatingChatBody = {
  resumeId?: string;
  locale?: string;
  sessionId?: string | null;
  messages?: Array<{ role?: string; content?: string }>;
  context?: unknown;
  modelConfig?: AgentModelConfig;
};

type FloatingSectionToolArgs = {
  fieldPath?: string;
  sectionId?: string;
  field?: string;
  section?: ResumeOperation["section"];
  operation?: ResumeOperation["operation"];
  beforePlainText?: string;
  value?: string;
  afterPlainText?: string;
  label?: string;
  changeSummary?: string;
};

type FloatingToolCall = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  summary: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type ExecutedFloatingToolCall = {
  toolCall: FloatingToolCall;
  operation: ResumeOperation | null;
};

type FloatingMessagePart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "tool"; toolCall: FloatingToolCall };

type FloatingStreamPart = {
  type: string;
  [key: string]: unknown;
};

const SECTION_VALUES = [
  "summary",
  "experience",
  "education",
  "projects",
  "research",
  "skills",
  "custom",
] as const;

const floatingUpdateSectionArgsSchema = z.object({
  fieldPath: z
    .string()
    .optional()
    .describe("Field path, e.g. experience.0.content"),
  sectionId: z.string().optional(),
  field: z.string().optional(),
  section: z.enum(SECTION_VALUES).optional(),
  beforePlainText: z.string().optional(),
  value: z.string(),
  label: z.string().optional(),
  changeSummary: z.string().optional(),
});

const floatingRewriteTextArgsSchema = z.object({
  fieldPath: z.string().optional(),
  sectionId: z.string().optional(),
  field: z.string().optional(),
  section: z.enum(SECTION_VALUES).optional(),
  beforePlainText: z.string().optional(),
  improvedText: z.string(),
  label: z.string().optional(),
  changeSummary: z.string().optional(),
});

const floatingAddSectionArgsSchema = z.object({
  section: z.enum(SECTION_VALUES),
  fieldPath: z.string().optional(),
  value: z.string(),
  label: z.string().optional(),
  changeSummary: z.string().optional(),
});

const floatingSuggestSkillsArgsSchema = z.object({
  skills: z.array(z.string()),
  category: z.string().optional(),
  fieldPath: z.string().optional(),
  beforePlainText: z.string().optional(),
  changeSummary: z.string().optional(),
});

const floatingAnalyzeJobMatchArgsSchema = z.object({
  jobDescription: z.string(),
  fieldPath: z.string().optional(),
  focus: z.string().optional(),
});

const floatingReadToolArgsSchema = z.object({
  fieldPath: z.string().optional(),
});

const SECTION_BY_FIELD_PREFIX: Array<[string, ResumeOperation["section"]]> = [
  ["basics.", "summary"],
  ["experience.", "experience"],
  ["education.", "education"],
  ["projects.", "projects"],
  ["research.", "research"],
  ["skills", "skills"],
  ["summary", "summary"],
  ["awards", "custom"],
  ["portfolio", "custom"],
  ["custom.", "custom"],
];

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as FloatingChatBody | null;
  if (!body || !body.modelConfig) {
    return Response.json(
      { error: "请先连接模型" },
      { status: 400 },
    );
  }

  const modelConfig = normalizeModelConfig(body.modelConfig);
  if (!modelConfig) {
    return Response.json(
      { error: "请填写模型服务地址、访问密钥和模型名称" },
      { status: 400 },
    );
  }

  const userMessages =
    body.messages
      ?.filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: String(message.content ?? ""),
      }))
      .filter((message) => message.content.trim().length > 0) ?? [];

  if (userMessages.length === 0) {
    return Response.json({ error: "消息不能为空" }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim() || null;
  const session = sessionId
    ? await getFloatingChatSession({ sessionId, userId })
    : null;
  if (sessionId && !session) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }
  if (session && body.resumeId && session.resumeId !== body.resumeId) {
    return Response.json({ error: "会话不属于当前简历" }, { status: 403 });
  }
  const lastUserMessage = [...userMessages].reverse().find((message) => message.role === "user");
  if (session && lastUserMessage?.content.trim()) {
    if (session.title === "新对话") {
      await renameFloatingChatSession({
        sessionId: session.id,
        userId,
        title: lastUserMessage.content.trim().slice(0, 50),
      });
    }
    await appendFloatingChatMessage({
      sessionId: session.id,
      role: "user",
      content: lastUserMessage.content.trim(),
    });
  }

  const executedToolCalls: ExecutedFloatingToolCall[] = [];
  const model = createOpenAICompatible({
    name: "intro-floating-openai-compatible",
    baseURL: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    includeUsage: true,
  })(modelConfig.modelName);

  const result = streamText({
    model,
    temperature: 0.2,
    messages: [
      ...userMessages,
    ],
    stopWhen: stepCountIs(25),
    tools: {
      readResume: createReadResumeTool(executedToolCalls, body.context),
      updateSection: createUpdateSectionTool(executedToolCalls),
      addSection: createAddSectionTool(executedToolCalls, body.context),
      rewriteText: createRewriteTextTool(executedToolCalls),
      suggestSkills: createSuggestSkillsTool(executedToolCalls),
      analyzeJobMatch: createAnalyzeJobMatchTool(executedToolCalls, body.context),
    },
  });

  return new Response(
    createFloatingChatEventStream({
      fullStream: result.fullStream,
      executedToolCalls,
      sessionId: session?.id ?? null,
    }),
    {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

function normalizeModelConfig(config: AgentModelConfig): AgentModelConfig | null {
  const baseUrl = config.baseUrl?.trim();
  const apiKey = config.apiKey?.trim();
  const modelName = config.modelName?.trim();
  if (!baseUrl || !apiKey || !modelName) return null;
  return { baseUrl, apiKey, modelName };
}

function createReadResumeTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  context: unknown,
) {
  return tool({
    description: "Read current resume context before deciding what to change.",
    inputSchema: floatingReadToolArgsSchema,
    execute: async (
      args: z.infer<typeof floatingReadToolArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const output = {
        success: true,
        context: selectResumeContext(context, args.fieldPath),
      };
      executedToolCalls.push({
        operation: null,
        toolCall: {
          id: toolCallId,
          name: "readResume",
          status: "completed",
          summary: args.fieldPath?.trim()
            ? `读取 ${args.fieldPath.trim()}`
            : "读取简历上下文",
          input: args,
          output,
        },
      });
      return output;
    },
  });
}

function createUpdateSectionTool(
  executedToolCalls: ExecutedFloatingToolCall[],
) {
  return tool({
    description: "Update the content of a specific resume section field.",
    inputSchema: floatingUpdateSectionArgsSchema,
    execute: async (
      args: z.infer<typeof floatingUpdateSectionArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId,
        toolName: "updateSection",
        args: { ...args, afterPlainText: args.value },
      });
    },
  });
}

function createRewriteTextTool(
  executedToolCalls: ExecutedFloatingToolCall[],
) {
  return tool({
    description: "Rewrite a resume text field to improve clarity and impact.",
    inputSchema: floatingRewriteTextArgsSchema,
    execute: async (
      args: z.infer<typeof floatingRewriteTextArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId,
        toolName: "rewriteText",
        args: { ...args, afterPlainText: args.improvedText },
      });
    },
  });
}

function createAddSectionTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  context: unknown,
) {
  return tool({
    description: "Add a new resume section or section item with concrete content.",
    inputSchema: floatingAddSectionArgsSchema,
    execute: async (
      args: z.infer<typeof floatingAddSectionArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId,
        toolName: "addSection",
        args: {
          ...args,
          fieldPath: args.fieldPath ?? defaultInsertFieldPath(args.section, context),
          afterPlainText: args.value,
          operation: "insert_section",
          label: args.label ?? "新增简历内容",
          changeSummary: args.changeSummary ?? "新增简历内容。",
        },
      });
    },
  });
}

function createSuggestSkillsTool(
  executedToolCalls: ExecutedFloatingToolCall[],
) {
  return tool({
    description: "Suggest relevant skills and update the skills section.",
    inputSchema: floatingSuggestSkillsArgsSchema,
    execute: async (
      args: z.infer<typeof floatingSuggestSkillsArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const category = args.category?.trim();
      const skillText = category
        ? `${category}\n${args.skills.join("、")}`
        : args.skills.join("、");
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId,
        toolName: "suggestSkills",
        args: {
          fieldPath: args.fieldPath ?? "skills",
          section: "skills",
          beforePlainText: args.beforePlainText,
          afterPlainText: skillText,
          label: "更新技能",
          changeSummary: args.changeSummary ?? "补充相关技能。",
        },
      });
    },
  });
}

function createAnalyzeJobMatchTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  context: unknown,
) {
  return tool({
    description: "Read the resume context needed to analyze match against a job description.",
    inputSchema: floatingAnalyzeJobMatchArgsSchema,
    execute: async (
      args: z.infer<typeof floatingAnalyzeJobMatchArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const output = {
        success: true,
        jobDescription: args.jobDescription,
        focus: args.focus ?? null,
        context: selectResumeContext(context, args.fieldPath),
      };
      executedToolCalls.push({
        operation: null,
        toolCall: {
          id: toolCallId,
          name: "analyzeJobMatch",
          status: "completed",
          summary: "分析岗位匹配",
          input: args,
          output,
        },
      });
      return output;
    },
  });
}

function executeResumeUpdateTool({
  executedToolCalls,
  toolCallId,
  toolName,
  args,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  toolCallId: string;
  toolName: string;
  args: FloatingSectionToolArgs;
}) {
  const operation = toResumeOperation(toolCallId, args);
  if (!operation) {
    const output = {
      success: false,
      error: "无法应用这次修改，请换一种说法或指定更明确的简历字段。",
    };
    executedToolCalls.push({
      operation: null,
      toolCall: {
        id: toolCallId,
        name: toolName,
        status: "error",
        summary: "修改参数不完整。",
        input: args,
        output,
        errorText: output.error,
      },
    });
    return output;
  }

  const output = {
    success: true,
    operationId: operation.id,
    fieldPath: operation.fieldPath,
    summary: operation.changeSummary,
  };
  executedToolCalls.push({
    operation,
    toolCall: {
      id: operation.toolCallId,
      name: toolName,
      status: "completed",
      summary: operation.changeSummary,
      input: args,
      output,
    },
  });
  return output;
}

function createFloatingChatEventStream({
  fullStream,
  executedToolCalls,
  sessionId,
}: {
  fullStream: AsyncIterable<FloatingStreamPart>;
  executedToolCalls: ExecutedFloatingToolCall[];
  sessionId: string | null;
}) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantMessage = "";
      let messageParts: FloatingMessagePart[] = [];
      const toolCalls = new Map<string, FloatingToolCall>();
      const inputBuffers = new Map<string, string>();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const sendToolEvent = (
        type: "tool-call-start" | "tool-call-delta" | "tool-call-result",
        toolCall: FloatingToolCall,
        operations: ResumeOperation[] = [],
      ) => {
        toolCalls.set(toolCall.id, toolCall);
        messageParts = upsertFloatingMessageToolPart(messageParts, toolCall);
        send({ type, toolCall, operations });
      };

      try {
        for await (const part of fullStream) {
          if (part.type === "text-delta" && typeof part.text === "string") {
            assistantMessage += part.text;
            messageParts = appendFloatingMessageTextPart(messageParts, part.text);
            send({ type: "text-delta", delta: part.text });
            continue;
          }

          if (
            part.type === "tool-input-start" &&
            typeof part.id === "string" &&
            typeof part.toolName === "string"
          ) {
            const toolCall = runningToolCall(part.id, part.toolName, {});
            sendToolEvent("tool-call-start", toolCall);
            continue;
          }

          if (
            part.type === "tool-input-delta" &&
            typeof part.id === "string" &&
            typeof part.delta === "string"
          ) {
            const previous = inputBuffers.get(part.id) ?? "";
            const nextInput = `${previous}${part.delta}`;
            inputBuffers.set(part.id, nextInput);
            const existing = toolCalls.get(part.id);
            if (existing) {
              sendToolEvent("tool-call-delta", {
                ...existing,
                input: nextInput,
              });
            }
            continue;
          }

          if (
            part.type === "tool-call" &&
            typeof part.toolCallId === "string" &&
            typeof part.toolName === "string"
          ) {
            sendToolEvent("tool-call-start", {
              ...runningToolCall(part.toolCallId, part.toolName, part.input),
            });
            continue;
          }

          if (
            part.type === "tool-result" &&
            typeof part.toolCallId === "string" &&
            typeof part.toolName === "string"
          ) {
            const executed = findExecutedToolCall(executedToolCalls, part.toolCallId);
            const toolCall = {
              id: part.toolCallId,
              name: part.toolName,
              status: "completed" as const,
              summary: executed?.toolCall.summary || `完成 ${part.toolName}`,
              input: executed?.toolCall.input ?? part.input,
              output: executed?.toolCall.output ?? part.output,
            };
            sendToolEvent(
              "tool-call-result",
              toolCall,
              executed?.operation ? [executed.operation] : [],
            );
            continue;
          }

          if (
            part.type === "tool-error" &&
            typeof part.toolCallId === "string" &&
            typeof part.toolName === "string"
          ) {
            sendToolEvent("tool-call-result", {
              id: part.toolCallId,
              name: part.toolName,
              status: "error",
              summary: `调用 ${part.toolName} 失败`,
              input: part.input,
              errorText: stringifyError(part.error),
            });
            continue;
          }

          if (part.type === "error") {
            throw part.error instanceof Error
              ? part.error
              : new Error("AI 助手暂时不可用");
          }
        }

        const responseToolCalls = mergeToolCalls(
          [...toolCalls.values()],
          executedToolCalls.map(({ toolCall }) => toolCall),
        );
        const operations = executedToolCalls
          .map(({ operation }) => operation)
          .filter((operation): operation is ResumeOperation => operation !== null);
        const finalMessage =
          assistantMessage.trim() ||
          (operations.length > 0
            ? `已根据你的要求修改 ${operations.length} 处简历内容。`
            : "我已经检查完这份简历。");
        const finalParts = finalizeFloatingMessageParts(
          messageParts,
          finalMessage,
          responseToolCalls,
        );

        if (sessionId && (finalMessage.trim() || responseToolCalls.length > 0)) {
          await appendFloatingChatMessage({
            sessionId,
            role: "assistant",
            content: finalMessage,
            toolCalls: persistedToolCalls(responseToolCalls),
            operations,
            parts: finalParts,
          });
        }

        send({
          type: "done",
          message: finalMessage,
          operations,
          toolCalls: responseToolCalls,
          parts: finalParts,
        });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "AI 助手暂时不可用",
        });
      } finally {
        controller.close();
      }
    },
  });
}

function runningToolCall(
  id: string,
  name: string,
  input: unknown,
): FloatingToolCall {
  return {
    id,
    name,
    status: "running",
    summary: `调用 ${name}`,
    input,
  };
}

function findExecutedToolCall(
  executedToolCalls: ExecutedFloatingToolCall[],
  toolCallId: string,
) {
  return executedToolCalls.find(({ toolCall }) => toolCall.id === toolCallId) ?? null;
}

function mergeToolCalls(
  streamedToolCalls: FloatingToolCall[],
  executedToolCalls: FloatingToolCall[],
) {
  const merged = new Map<string, FloatingToolCall>();
  for (const toolCall of streamedToolCalls) {
    merged.set(toolCall.id, toolCall);
  }
  for (const toolCall of executedToolCalls) {
    merged.set(toolCall.id, {
      ...(merged.get(toolCall.id) ?? {}),
      ...toolCall,
    });
  }
  return [...merged.values()];
}

function persistedToolCalls(toolCalls: FloatingToolCall[]) {
  return toolCalls.filter(
    (toolCall): toolCall is FloatingToolCall & { status: "completed" | "error" } =>
      toolCall.status !== "running",
  );
}

function appendFloatingMessageTextPart(
  parts: FloatingMessagePart[],
  delta: string,
): FloatingMessagePart[] {
  if (!delta) return parts;
  const last = parts.at(-1);
  if (last?.type === "text") {
    return [
      ...parts.slice(0, -1),
      { ...last, text: last.text + delta },
    ];
  }
  return [
    ...parts,
    { id: createToolCallId().replace(/^tool_/, "part_text_"), type: "text", text: delta },
  ];
}

function upsertFloatingMessageToolPart(
  parts: FloatingMessagePart[],
  toolCall: FloatingToolCall,
): FloatingMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === "tool" && part.toolCall.id === toolCall.id,
  );
  if (index === -1) {
    return [
      ...parts,
      { id: `part_tool_${toolCall.id}`, type: "tool", toolCall },
    ];
  }
  const next = [...parts];
  const existing = next[index];
  next[index] = {
    id: existing.id,
    type: "tool",
    toolCall: {
      ...(existing.type === "tool" ? existing.toolCall : {}),
      ...toolCall,
      input: toolCall.input ?? (existing.type === "tool" ? existing.toolCall.input : undefined),
      output: toolCall.output ?? (existing.type === "tool" ? existing.toolCall.output : undefined),
      errorText: toolCall.errorText ?? (existing.type === "tool" ? existing.toolCall.errorText : undefined),
    },
  };
  return next;
}

function finalizeFloatingMessageParts(
  parts: FloatingMessagePart[],
  finalText: string,
  toolCalls: FloatingToolCall[],
): FloatingMessagePart[] {
  let next = parts;
  for (const toolCall of toolCalls) {
    next = upsertFloatingMessageToolPart(next, toolCall);
  }
  const hasText = next.some((part) => part.type === "text" && part.text.trim());
  if (!hasText && finalText.trim()) {
    next = appendFloatingMessageTextPart(next, finalText.trim());
  }
  return next;
}

function selectResumeContext(context: unknown, fieldPath?: string) {
  const path = fieldPath?.trim();
  if (!path) return context ?? {};
  const sections = typeof context === "object" && context !== null
    ? (context as { sections?: unknown }).sections
    : null;
  if (Array.isArray(sections)) {
    const match = sections.find((section) => {
      if (!section || typeof section !== "object") return false;
      return (section as { fieldPath?: unknown }).fieldPath === path;
    });
    if (match) return match;
  }
  return context ?? {};
}

function defaultInsertFieldPath(section: ResumeOperation["section"], context: unknown) {
  if (section === "summary" || section === "skills") return section;
  const index = countContextSections(context, section);
  if (section === "education") return `education.${index}.highlights`;
  return `${section}.${index}.content`;
}

function countContextSections(context: unknown, section: ResumeOperation["section"]) {
  const sections = typeof context === "object" && context !== null
    ? (context as { sections?: unknown }).sections
    : null;
  if (!Array.isArray(sections)) return 0;
  return sections.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as { key?: unknown; fieldPath?: unknown };
    if (record.key === section) return true;
    return typeof record.fieldPath === "string" && record.fieldPath.startsWith(`${section}.`);
  }).length;
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "工具调用失败");
}

function toResumeOperation(
  toolCallId: string,
  args: FloatingSectionToolArgs,
): ResumeOperation | null {
  const fieldPath = resolveFieldPath(args);
  const afterPlainText = args.afterPlainText?.trim();
  if (!fieldPath || !afterPlainText) return null;
  const section = args.section ?? inferSection(fieldPath);
  if (!section) return null;

  return {
    id: `floating_${toolCallId}`,
    toolCallId,
    label: args.label?.trim() || "更新简历内容",
    section,
    fieldPath,
    operation: args.operation ?? "update_section",
    beforePlainText: args.beforePlainText ?? "",
    afterPlainText,
    changeSummary: args.changeSummary?.trim() || `更新 ${fieldPath}`,
    riskFlags: [],
  };
}

function resolveFieldPath(args: FloatingSectionToolArgs) {
  const fieldPath = args.fieldPath?.trim();
  if (fieldPath) return fieldPath;
  const sectionId = args.sectionId?.trim();
  if (!sectionId) return null;
  const field = args.field?.trim();
  if (!field) return sectionId;
  return sectionId.endsWith(`.${field}`) ? sectionId : `${sectionId}.${field}`;
}

function createToolCallId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `tool_${crypto.randomUUID()}`;
  }
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function inferSection(fieldPath: string): ResumeOperation["section"] | null {
  const match = SECTION_BY_FIELD_PREFIX.find(([prefix]) =>
    fieldPath === prefix || fieldPath.startsWith(prefix),
  );
  return match?.[1] ?? null;
}
