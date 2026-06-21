import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { currentUserId } from "@/lib/auth-helpers";
import {
  appendFloatingChatMessage,
  getFloatingChatSession,
  renameFloatingChatSession,
} from "@/lib/agent/floating-chat-session-store";
import { normalizeAgentRichTextInput } from "@/lib/agent/rich-text-conversion";
import type {
  AgentModelConfig,
  AgentOperationApprovalRequest,
  AgentWriteMode,
  ResumeOperation,
} from "@intro-builder/shared/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FloatingChatBody = {
  resumeId?: string;
  locale?: string;
  sessionId?: string | null;
  messages?: Array<{ role?: string; content?: string }>;
  context?: unknown;
  modelConfig?: AgentModelConfig;
  writeMode?: AgentWriteMode;
  approvalDecisions?: FloatingApprovalDecision[];
  persistLastUserMessage?: boolean;
};

type FloatingSectionToolArgs = {
  fieldPath?: string;
  sectionId?: string;
  field?: string;
  section?: ResumeOperation["section"];
  operation?: ResumeOperation["operation"];
  beforePlainText?: string;
  value?: string;
  replacementValue?: unknown;
  replacementTiptapJson?: unknown;
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
  question?: FloatingQuestionRequest;
};

type FloatingMessagePart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "tool"; toolCall: FloatingToolCall }
  | { id: string; type: "approval"; approvalRequest: AgentOperationApprovalRequest }
  | { id: string; type: "question"; question: FloatingQuestionRequest };

type FloatingStreamPart = {
  type: string;
  [key: string]: unknown;
};

const floatingSuggestSkillsArgsSchema = z.object({
  skills: z.array(z.string()),
  category: z.string().optional(),
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

const floatingAskUserArgsSchema = z.object({
  question: z.string().min(1).describe("向用户提出的具体问题"),
  field: z.string().optional().describe("关联的简历字段路径，例如 projects.0.content"),
});

type FloatingQuestionRequest = {
  id: string;
  question: string;
  field?: string;
  status: "pending" | "answered";
  answer?: string;
};

type FloatingApprovalDecision = {
  approvalId: string;
  approved: boolean;
};

const floatingCommonSemanticArgsSchema = {
  beforePlainText: z.string().optional(),
  changeSummary: z.string().optional(),
};
const floatingRichTextStringSchema = z
  .string()
  .describe("Plain resume text. Do not include HTML tags; use line breaks or '- ' bullets for lists.");

const floatingBasicsBlockArgsSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  title: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  summary: z.string().optional(),
  photo: z.string().optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingStyleSettingsBlockArgsSchema = z.object({
  fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
  fontSize: z.number().min(8).max(16).optional(),
  lineHeight: z.number().min(1.05).max(2).optional(),
  bodyLineHeight: z.number().min(1.05).max(2).optional(),
  headingGap: z.number().min(0).max(32).optional(),
  pagePadding: z.number().min(8).max(60).optional(),
  sectionGap: z.number().min(4).max(24).optional(),
  itemGap: z.number().min(2).max(16).optional(),
  photoScale: z.number().min(0.5).max(1.5).optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingAddWorkExperienceArgsSchema = z.object({
  company: z.string().optional(),
  title: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  location: z.string().optional(),
  content: floatingRichTextStringSchema,
  ...floatingCommonSemanticArgsSchema,
});

const floatingWorkExperienceBlockArgsSchema = z.object({
  index: z.number().int().min(0),
  company: z.string().optional(),
  title: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  location: z.string().optional(),
  content: floatingRichTextStringSchema.optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingAddEducationArgsSchema = z.object({
  school: z.string().optional(),
  degree: z.string().optional(),
  major: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  gpa: z.string().optional(),
  highlights: floatingRichTextStringSchema,
  ...floatingCommonSemanticArgsSchema,
});

const floatingEducationBlockArgsSchema = z.object({
  index: z.number().int().min(0),
  school: z.string().optional(),
  degree: z.string().optional(),
  major: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  gpa: z.string().optional(),
  highlights: floatingRichTextStringSchema.optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingAddProjectArgsSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  stack: z.array(z.string()).optional(),
  link: z.string().optional(),
  content: floatingRichTextStringSchema,
  ...floatingCommonSemanticArgsSchema,
});

const floatingProjectBlockArgsSchema = z.object({
  index: z.number().int().min(0),
  name: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  stack: z.array(z.string()).optional(),
  link: z.string().optional(),
  content: floatingRichTextStringSchema.optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingAddResearchArgsSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  paperTitle: z.string().optional(),
  link: z.string().optional(),
  content: floatingRichTextStringSchema,
  ...floatingCommonSemanticArgsSchema,
});

const floatingResearchBlockArgsSchema = z.object({
  index: z.number().int().min(0),
  name: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  paperTitle: z.string().optional(),
  link: z.string().optional(),
  content: floatingRichTextStringSchema.optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingSingletonContentArgsSchema = z.object({
  content: floatingRichTextStringSchema,
  ...floatingCommonSemanticArgsSchema,
});

const floatingAddCustomSectionArgsSchema = z.object({
  title: z.string().min(1),
  content: floatingRichTextStringSchema,
  ...floatingCommonSemanticArgsSchema,
});

const floatingCustomSectionBlockArgsSchema = z.object({
  sectionId: z.string().min(1),
  title: z.string().optional(),
  content: floatingRichTextStringSchema.optional(),
  ...floatingCommonSemanticArgsSchema,
});

const floatingDeleteCustomSectionArgsSchema = z.object({
  sectionId: z.string().min(1),
  beforePlainText: z.string().optional(),
  changeSummary: z.string().optional(),
});

const floatingItemIndexArgsSchema = z.object({
  index: z.number().int().min(0),
  beforePlainText: z.string().optional(),
  changeSummary: z.string().optional(),
});

const floatingItemOrderArgsSchema = z.object({
  itemOrder: z.array(z.number().int().min(0)).min(1),
  changeSummary: z.string().optional(),
});

const floatingCustomItemOrderArgsSchema = z.object({
  itemOrder: z.array(z.string().min(1)).min(1),
  changeSummary: z.string().optional(),
});

const BUILTIN_MODULE_KEYS = [
  "experience",
  "education",
  "projects",
  "research",
  "skills",
  "summary",
  "awards",
  "portfolio",
] as const;

const floatingHideModuleArgsSchema = z.object({
  moduleKey: z.enum(BUILTIN_MODULE_KEYS),
  changeSummary: z.string().optional(),
});

const floatingShowModuleArgsSchema = z.object({
  moduleKey: z.enum(BUILTIN_MODULE_KEYS),
  position: z.number().int().min(0).optional(),
  changeSummary: z.string().optional(),
});

const floatingReorderModulesArgsSchema = z.object({
  sectionOrder: z.array(z.string().min(1)).min(1),
  changeSummary: z.string().optional(),
});

const SECTION_BY_FIELD_PREFIX: Array<[string, ResumeOperation["section"]]> = [
  ["basics.", "basics"],
  ["experience.", "experience"],
  ["education.", "education"],
  ["projects.", "projects"],
  ["research.", "research"],
  ["skills", "skills"],
  ["summary", "summary"],
  ["awards", "awards"],
  ["portfolio", "portfolio"],
  ["custom.", "custom"],
  ["styleSettings.", "style"],
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
  const approvalDecisions = normalizeFloatingApprovalDecisions(body.approvalDecisions);
  const shouldPersistLastUserMessage =
    body.persistLastUserMessage !== false && approvalDecisions.length === 0;
  if (session && lastUserMessage?.content.trim() && shouldPersistLastUserMessage) {
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
  const writeMode = readFloatingWriteMode(body.writeMode);
  const model = createOpenAICompatible({
    name: "intro-floating-openai-compatible",
    baseURL: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    includeUsage: true,
  })(modelConfig.modelName);

  const result = streamText({
    model,
    temperature: 0.2,
    system: buildFloatingSystemPrompt({ writeMode, approvalDecisions }),
    messages: [
      ...userMessages,
    ],
    stopWhen: stepCountIs(25),
    tools: {
      readResume: createReadResumeTool(executedToolCalls, body.context),
      askUser: createAskUserTool(executedToolCalls),
      updateBasicsBlock: createBasicsBlockTool(executedToolCalls, writeMode),
      writeSkillsSection: createSingletonRichTextTool({
        executedToolCalls,
        writeMode,
        toolName: "writeSkillsSection",
        section: "skills",
        fieldPath: "skills",
        label: "更新专业技能",
        description: "Write the standalone skills section.",
      }),
      writePersonalSummarySection: createSingletonRichTextTool({
        executedToolCalls,
        writeMode,
        toolName: "writePersonalSummarySection",
        section: "summary",
        fieldPath: "summary",
        label: "更新个人总结",
        description: "Write the standalone personal summary section.",
      }),
      writeAwardsSection: createSingletonRichTextTool({
        executedToolCalls,
        writeMode,
        toolName: "writeAwardsSection",
        section: "awards",
        fieldPath: "awards",
        label: "更新荣誉奖项",
        description: "Write the standalone awards section.",
      }),
      writePortfolioSection: createSingletonRichTextTool({
        executedToolCalls,
        writeMode,
        toolName: "writePortfolioSection",
        section: "portfolio",
        fieldPath: "portfolio",
        label: "更新作品集",
        description: "Write the standalone portfolio section.",
      }),
      addCustomSection: createAddCustomSectionTool(
        executedToolCalls,
        body.context,
        writeMode,
      ),
      updateCustomSectionBlock: createUpdateCustomSectionBlockTool(
        executedToolCalls,
        writeMode,
      ),
      deleteCustomSection: createDeleteCustomSectionTool(
        executedToolCalls,
        writeMode,
      ),
      reorderCustomSections: createReorderCustomSectionsTool(
        executedToolCalls,
        writeMode,
      ),
      updateStyleSettingsBlock: createStyleSettingsBlockTool(executedToolCalls, writeMode),
      addWorkExperience: createAddItemTool({
        executedToolCalls,
        context: body.context,
        writeMode,
        toolName: "addWorkExperience",
        section: "experience",
        label: "新增工作经历",
        description: "Add one work experience item with metadata and rich-text content.",
        inputSchema: floatingAddWorkExperienceArgsSchema,
        fields: ["company", "title", "start", "end", "location"],
        contentField: "content",
      }),
      updateWorkExperienceBlock: createItemBlockTool({
        executedToolCalls,
        writeMode,
        toolName: "updateWorkExperienceBlock",
        section: "experience",
        label: "更新工作经历块",
        description: "Update one work experience block, including metadata and optional content.",
        inputSchema: floatingWorkExperienceBlockArgsSchema,
        fields: ["company", "title", "start", "end", "location"],
        contentField: "content",
      }),
      addEducation: createAddItemTool({
        executedToolCalls,
        context: body.context,
        writeMode,
        toolName: "addEducation",
        section: "education",
        label: "新增教育经历",
        description: "Add one education item with metadata and rich-text highlights.",
        inputSchema: floatingAddEducationArgsSchema,
        fields: ["school", "degree", "major", "location", "start", "end", "gpa"],
        contentField: "highlights",
      }),
      updateEducationBlock: createItemBlockTool({
        executedToolCalls,
        writeMode,
        toolName: "updateEducationBlock",
        section: "education",
        label: "更新教育经历块",
        description: "Update one education block, including metadata and optional highlights.",
        inputSchema: floatingEducationBlockArgsSchema,
        fields: ["school", "degree", "major", "location", "start", "end", "gpa"],
        contentField: "highlights",
      }),
      addProject: createAddItemTool({
        executedToolCalls,
        context: body.context,
        writeMode,
        toolName: "addProject",
        section: "projects",
        label: "新增项目经历",
        description: "Add one project item with metadata and rich-text content.",
        inputSchema: floatingAddProjectArgsSchema,
        fields: ["name", "role", "location", "start", "end", "stack", "link"],
        contentField: "content",
      }),
      updateProjectBlock: createItemBlockTool({
        executedToolCalls,
        writeMode,
        toolName: "updateProjectBlock",
        section: "projects",
        label: "更新项目经历块",
        description: "Update one project block, including metadata and optional content.",
        inputSchema: floatingProjectBlockArgsSchema,
        fields: ["name", "role", "location", "start", "end", "stack", "link"],
        contentField: "content",
      }),
      addResearch: createAddItemTool({
        executedToolCalls,
        context: body.context,
        writeMode,
        toolName: "addResearch",
        section: "research",
        label: "新增研究经历",
        description: "Add one research item with metadata and rich-text content.",
        inputSchema: floatingAddResearchArgsSchema,
        fields: ["name", "role", "location", "start", "end", "paperTitle", "link"],
        contentField: "content",
      }),
      updateResearchBlock: createItemBlockTool({
        executedToolCalls,
        writeMode,
        toolName: "updateResearchBlock",
        section: "research",
        label: "更新研究经历块",
        description: "Update one research block, including metadata and optional content.",
        inputSchema: floatingResearchBlockArgsSchema,
        fields: ["name", "role", "location", "start", "end", "paperTitle", "link"],
        contentField: "content",
      }),
      deleteWorkExperience: createDeleteItemTool({
        executedToolCalls,
        writeMode,
        toolName: "deleteWorkExperience",
        section: "experience",
        label: "删除工作经历",
        description: "Delete one work experience item.",
      }),
      deleteEducation: createDeleteItemTool({
        executedToolCalls,
        writeMode,
        toolName: "deleteEducation",
        section: "education",
        label: "删除教育经历",
        description: "Delete one education item.",
      }),
      deleteProject: createDeleteItemTool({
        executedToolCalls,
        writeMode,
        toolName: "deleteProject",
        section: "projects",
        label: "删除项目经历",
        description: "Delete one project item.",
      }),
      deleteResearch: createDeleteItemTool({
        executedToolCalls,
        writeMode,
        toolName: "deleteResearch",
        section: "research",
        label: "删除研究经历",
        description: "Delete one research item.",
      }),
      reorderWorkExperiences: createReorderItemsTool({
        executedToolCalls,
        writeMode,
        toolName: "reorderWorkExperiences",
        section: "experience",
        label: "调整工作经历顺序",
        description: "Reorder work experience items.",
      }),
      reorderEducation: createReorderItemsTool({
        executedToolCalls,
        writeMode,
        toolName: "reorderEducation",
        section: "education",
        label: "调整教育经历顺序",
        description: "Reorder education items.",
      }),
      reorderProjects: createReorderItemsTool({
        executedToolCalls,
        writeMode,
        toolName: "reorderProjects",
        section: "projects",
        label: "调整项目经历顺序",
        description: "Reorder project items.",
      }),
      reorderResearch: createReorderItemsTool({
        executedToolCalls,
        writeMode,
        toolName: "reorderResearch",
        section: "research",
        label: "调整研究经历顺序",
        description: "Reorder research items.",
      }),
      hideResumeModule: createHideResumeModuleTool(executedToolCalls, writeMode),
      showResumeModule: createShowResumeModuleTool(
        executedToolCalls,
        body.context,
        writeMode,
      ),
      reorderResumeModules: createReorderResumeModulesTool(executedToolCalls, writeMode),
      suggestSkills: createSuggestSkillsTool(executedToolCalls, writeMode),
      analyzeJobMatch: createAnalyzeJobMatchTool(executedToolCalls, body.context),
    },
  });

  return new Response(
    createFloatingChatEventStream({
      fullStream: result.fullStream,
      executedToolCalls,
      sessionId: session?.id ?? null,
      writeMode,
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

function readFloatingWriteMode(value: unknown): AgentWriteMode {
  return value === "approval" ? "approval" : "direct";
}

function buildFloatingSystemPrompt({
  writeMode,
  approvalDecisions,
}: {
  writeMode: AgentWriteMode;
  approvalDecisions: FloatingApprovalDecision[];
}) {
  const lines = [
    "你是 intro-builder 的简历优化助手，正在 floating 对话中帮助用户编辑简历。",
    "先读取简历上下文，再决定要追问、诊断还是修改。",
    "只依据用户提供的事实写作；缺少目标岗位、项目结果、量化指标、公司/学校等关键事实时，调用 askUser 追问，不要编造。",
    "富文本内容工具参数使用纯文本、换行或列表符号，不要输出 HTML 标签。",
    writeMode === "approval"
      ? "当前为请求批准模式：提出修改建议后等待用户应用或忽略。"
      : "当前为直接修改模式：可以直接应用确定的修改。",
  ];
  if (approvalDecisions.length > 0) {
    const approved = approvalDecisions
      .filter((decision) => decision.approved)
      .map((decision) => decision.approvalId);
    const rejected = approvalDecisions
      .filter((decision) => !decision.approved)
      .map((decision) => decision.approvalId);
    lines.push("用户刚刚审核了上一批修改建议，请继续同一个任务。");
    if (approved.length > 0) lines.push(`已应用：${approved.join(", ")}`);
    if (rejected.length > 0) lines.push(`已忽略：${rejected.join(", ")}。不要重复提出已忽略的建议。`);
  }
  return lines.join("\n");
}

function normalizeFloatingApprovalDecisions(
  value: unknown,
): FloatingApprovalDecision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.approvalId !== "string" || !record.approvalId.trim()) {
      return [];
    }
    if (typeof record.approved !== "boolean") return [];
    return [{ approvalId: record.approvalId.trim(), approved: record.approved }];
  });
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

function createAskUserTool(executedToolCalls: ExecutedFloatingToolCall[]) {
  return tool({
    description:
      "Ask the user for missing facts, target role, preference, or approval context. Use this instead of guessing.",
    inputSchema: floatingAskUserArgsSchema,
    execute: async (
      args: z.infer<typeof floatingAskUserArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const question: FloatingQuestionRequest = {
        id: `floating_question_${toolCallId}`,
        question: args.question.trim(),
        ...(args.field?.trim() ? { field: args.field.trim() } : {}),
        status: "pending",
      };
      const output = {
        success: true,
        questionId: question.id,
        question: question.question,
        field: question.field ?? null,
      };
      executedToolCalls.push({
        operation: null,
        question,
        toolCall: {
          id: toolCallId,
          name: "askUser",
          status: "completed",
          summary: question.question,
          input: args,
          output,
        },
      });
      return output;
    },
  });
}

function createBasicsBlockTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Update the resume basics block, including identity, contact, headline, photo, and intro.",
    inputSchema: floatingBasicsBlockArgsSchema,
    execute: async (
      args: z.infer<typeof floatingBasicsBlockArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const record = args as Record<string, unknown>;
      const values = pickBlockValues(record, [
        "name",
        "status",
        "title",
        "email",
        "phone",
        "location",
        "website",
        "summary",
        "photo",
      ]);
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId: options.toolCallId ?? createToolCallId(),
        toolName: "updateBasicsBlock",
        args: {
          fieldPath: "basics",
          section: "basics",
          beforePlainText: stringArg(record.beforePlainText),
          afterPlainText: summarizeBlockValues(values),
          replacementValue: values,
          label: "更新基础信息",
          changeSummary: stringArg(record.changeSummary) ?? "更新基础信息块。",
        },
        writeMode,
      });
    },
  });
}

function createStyleSettingsBlockTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Update the resume style settings block, including typography, spacing, page padding, and photo scale.",
    inputSchema: floatingStyleSettingsBlockArgsSchema,
    execute: async (
      args: z.infer<typeof floatingStyleSettingsBlockArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const record = args as Record<string, unknown>;
      const values = pickBlockValues(record, [
        "fontFamily",
        "fontSize",
        "lineHeight",
        "bodyLineHeight",
        "headingGap",
        "pagePadding",
        "sectionGap",
        "itemGap",
        "photoScale",
      ]);
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId: options.toolCallId ?? createToolCallId(),
        toolName: "updateStyleSettingsBlock",
        args: {
          fieldPath: "styleSettings",
          section: "style",
          beforePlainText: stringArg(record.beforePlainText),
          afterPlainText: summarizeBlockValues(values),
          replacementValue: values,
          label: "调整简历样式",
          changeSummary: stringArg(record.changeSummary) ?? "调整简历样式。",
        },
        writeMode,
      });
    },
  });
}

function createSingletonRichTextTool({
  executedToolCalls,
  writeMode,
  toolName,
  section,
  fieldPath,
  label,
  description,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  writeMode: AgentWriteMode;
  toolName: string;
  section: Extract<ResumeOperation["section"], "skills" | "summary" | "awards" | "portfolio">;
  fieldPath: string;
  label: string;
  description: string;
}) {
  return tool({
    description,
    inputSchema: floatingSingletonContentArgsSchema,
    execute: async (
      args: z.infer<typeof floatingSingletonContentArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const richText = normalizeAgentRichTextInput(args.content);
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId: options.toolCallId ?? createToolCallId(),
        toolName,
        args: {
          fieldPath,
          section,
          beforePlainText: args.beforePlainText,
          afterPlainText: richText.plainText,
          replacementTiptapJson: richText.tiptapJson,
          label,
          changeSummary: args.changeSummary ?? `${label}。`,
        },
        writeMode,
      });
    },
  });
}

function createAddItemTool<TSchema extends z.ZodObject<z.ZodRawShape>>({
  executedToolCalls,
  context,
  writeMode,
  toolName,
  section,
  label,
  description,
  inputSchema,
  fields,
  contentField,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  context: unknown;
  writeMode: AgentWriteMode;
  toolName: string;
  section: Extract<ResumeOperation["section"], "experience" | "education" | "projects" | "research">;
  label: string;
  description: string;
  inputSchema: TSchema;
  fields: string[];
  contentField: "content" | "highlights";
}) {
  return tool({
    description,
    inputSchema,
    execute: async (
      args: z.infer<TSchema>,
      options: { toolCallId?: string },
    ) => {
      const record = args as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      for (const field of fields) {
        if (record[field] !== undefined) values[field] = record[field];
      }
      const richText = normalizeAgentRichTextInput(String(record[contentField] ?? ""));
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName,
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section,
          fieldPath: `${section}.${countContextSections(context, section)}`,
          operation: "insert_section",
          beforePlainText: stringArg(record.beforePlainText) ?? "",
          afterPlainText: richText.plainText,
          replacementValue: values,
          replacementTiptapJson: richText.tiptapJson,
          changeSummary: stringArg(record.changeSummary) ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createAddCustomSectionTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  context: unknown,
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Add one custom resume section with a title and rich-text content.",
    inputSchema: floatingAddCustomSectionArgsSchema,
    execute: async (
      args: z.infer<typeof floatingAddCustomSectionArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const label = "新增自定义模块";
      const richText = normalizeAgentRichTextInput(args.content);
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "addCustomSection",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section: "custom",
          fieldPath: `custom.${countContextSections(context, "custom")}`,
          operation: "insert_section",
          beforePlainText: args.beforePlainText ?? "",
          afterPlainText: richText.plainText,
          replacementValue: { title: args.title },
          replacementTiptapJson: richText.tiptapJson,
          changeSummary: args.changeSummary ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createUpdateCustomSectionBlockTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Update one custom resume section block by section id, including title and optional rich-text content.",
    inputSchema: floatingCustomSectionBlockArgsSchema,
    execute: async (
      args: z.infer<typeof floatingCustomSectionBlockArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const label = "更新自定义模块";
      const values: Record<string, unknown> = {};
      if (args.title !== undefined) values.title = args.title;
      const richText = args.content === undefined
        ? null
        : normalizeAgentRichTextInput(args.content);
      if (richText) values.content = richText.plainText;
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "updateCustomSectionBlock",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section: "custom",
          fieldPath: customSectionFieldPath(args.sectionId),
          operation: "update_section",
          beforePlainText: args.beforePlainText ?? "",
          afterPlainText: richText?.plainText ?? args.title ?? summarizeBlockValues(values),
          replacementValue: values,
          replacementTiptapJson: richText?.tiptapJson,
          changeSummary: args.changeSummary ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createDeleteCustomSectionTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Delete an existing custom resume section by section id.",
    inputSchema: floatingDeleteCustomSectionArgsSchema,
    execute: async (
      args: z.infer<typeof floatingDeleteCustomSectionArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const label = "删除自定义模块";
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "deleteCustomSection",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section: "custom",
          fieldPath: customSectionFieldPath(args.sectionId),
          operation: "delete_section",
          beforePlainText: args.beforePlainText ?? "",
          afterPlainText: "",
          changeSummary: args.changeSummary ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createReorderCustomSectionsTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Reorder custom resume sections by their section ids.",
    inputSchema: floatingCustomItemOrderArgsSchema,
    execute: async (
      args: z.infer<typeof floatingCustomItemOrderArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      const label = "调整自定义模块顺序";
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "reorderCustomSections",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section: "custom",
          fieldPath: "custom",
          operation: "reorder_items",
          beforePlainText: "",
          afterPlainText: args.itemOrder.join(","),
          itemOrder: args.itemOrder,
          changeSummary: args.changeSummary ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createItemBlockTool<TSchema extends z.ZodObject<z.ZodRawShape>>({
  executedToolCalls,
  writeMode,
  toolName,
  section,
  label,
  description,
  inputSchema,
  fields,
  contentField,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  writeMode: AgentWriteMode;
  toolName: string;
  section: Extract<ResumeOperation["section"], "experience" | "education" | "projects" | "research">;
  label: string;
  description: string;
  inputSchema: TSchema;
  fields: string[];
  contentField: "content" | "highlights";
}) {
  return tool({
    description,
    inputSchema,
    execute: async (
      args: z.infer<TSchema>,
      options: { toolCallId?: string },
    ) => {
      const record = args as Record<string, unknown>;
      const index = Number(record.index);
      const values: Record<string, unknown> = {};
      for (const field of fields) {
        if (record[field] !== undefined) values[field] = normalizeBlockFieldValue(record[field]);
      }
      const hasContent = typeof record[contentField] === "string";
      const richText = hasContent
        ? normalizeAgentRichTextInput(String(record[contentField]))
        : null;
      if (richText) values[contentField] = richText.plainText;
      const afterPlainText = hasContent
        ? richText?.plainText ?? ""
        : summarizeBlockValues(values);
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId: options.toolCallId ?? createToolCallId(),
        toolName,
        args: {
          fieldPath: `${section}.${index}`,
          section,
          beforePlainText: stringArg(record.beforePlainText),
          afterPlainText,
          replacementValue: values,
          replacementTiptapJson: richText?.tiptapJson,
          label,
          changeSummary: stringArg(record.changeSummary) ?? `${label}。`,
        },
        writeMode,
      });
    },
  });
}

function createDeleteItemTool({
  executedToolCalls,
  writeMode,
  toolName,
  section,
  label,
  description,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  writeMode: AgentWriteMode;
  toolName: string;
  section: Extract<ResumeOperation["section"], "experience" | "education" | "projects" | "research">;
  label: string;
  description: string;
}) {
  return tool({
    description,
    inputSchema: floatingItemIndexArgsSchema,
    execute: async (
      args: z.infer<typeof floatingItemIndexArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName,
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section,
          fieldPath: `${section}.${args.index}`,
          operation: "delete_section",
          beforePlainText: args.beforePlainText ?? "",
          afterPlainText: "",
          changeSummary: args.changeSummary ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createReorderItemsTool({
  executedToolCalls,
  writeMode,
  toolName,
  section,
  label,
  description,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  writeMode: AgentWriteMode;
  toolName: string;
  section: Extract<ResumeOperation["section"], "experience" | "education" | "projects" | "research">;
  label: string;
  description: string;
}) {
  return tool({
    description,
    inputSchema: floatingItemOrderArgsSchema,
    execute: async (
      args: z.infer<typeof floatingItemOrderArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName,
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label,
          section,
          fieldPath: section,
          operation: "reorder_items",
          beforePlainText: "",
          afterPlainText: args.itemOrder.join(","),
          itemOrder: args.itemOrder,
          changeSummary: args.changeSummary ?? `${label}。`,
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createHideResumeModuleTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Hide a built-in resume module by removing it from the visible section order.",
    inputSchema: floatingHideModuleArgsSchema,
    execute: async (
      args: z.infer<typeof floatingHideModuleArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "hideResumeModule",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label: "隐藏简历模块",
          section: sectionForModuleKey(args.moduleKey),
          fieldPath: args.moduleKey,
          operation: "delete_section",
          beforePlainText: args.moduleKey,
          afterPlainText: "",
          changeSummary: args.changeSummary ?? "隐藏简历模块。",
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createShowResumeModuleTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  context: unknown,
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Show a built-in resume module by adding it back to the visible section order.",
    inputSchema: floatingShowModuleArgsSchema,
    execute: async (
      args: z.infer<typeof floatingShowModuleArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const currentOrder = readContextSectionOrder(context);
      const toolCallId = options.toolCallId ?? createToolCallId();
      if (!currentOrder) {
        return executeResumeOperationTool({
          executedToolCalls,
          toolCallId,
          toolName: "showResumeModule",
          operation: null,
          input: args,
          writeMode,
        });
      }
      const orderWithoutModule = currentOrder.filter((key) => key !== args.moduleKey);
      const insertAt = args.position === undefined
        ? orderWithoutModule.length
        : Math.min(args.position, orderWithoutModule.length);
      const nextOrder = [
        ...orderWithoutModule.slice(0, insertAt),
        args.moduleKey,
        ...orderWithoutModule.slice(insertAt),
      ];
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "showResumeModule",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label: "显示简历模块",
          section: sectionForModuleKey(args.moduleKey),
          fieldPath: "sectionOrder",
          operation: "reorder_sections",
          beforePlainText: currentOrder.join(","),
          afterPlainText: nextOrder.join(","),
          sectionOrder: nextOrder,
          changeSummary: args.changeSummary ?? "显示简历模块。",
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createReorderResumeModulesTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
) {
  return tool({
    description: "Reorder visible resume modules using section keys.",
    inputSchema: floatingReorderModulesArgsSchema,
    execute: async (
      args: z.infer<typeof floatingReorderModulesArgsSchema>,
      options: { toolCallId?: string },
    ) => {
      const toolCallId = options.toolCallId ?? createToolCallId();
      return executeResumeOperationTool({
        executedToolCalls,
        toolCallId,
        toolName: "reorderResumeModules",
        operation: {
          id: `floating_${toolCallId}`,
          toolCallId,
          label: "调整模块顺序",
          section: "custom",
          fieldPath: "sectionOrder",
          operation: "reorder_sections",
          beforePlainText: "",
          afterPlainText: args.sectionOrder.join(","),
          sectionOrder: args.sectionOrder,
          changeSummary: args.changeSummary ?? "调整简历模块顺序。",
          riskFlags: [],
        },
        input: args,
        writeMode,
      });
    },
  });
}

function createSuggestSkillsTool(
  executedToolCalls: ExecutedFloatingToolCall[],
  writeMode: AgentWriteMode,
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
      const richText = normalizeAgentRichTextInput(skillText);
      return executeResumeUpdateTool({
        executedToolCalls,
        toolCallId,
        toolName: "suggestSkills",
        args: {
          fieldPath: "skills",
          section: "skills",
          beforePlainText: args.beforePlainText,
          afterPlainText: richText.plainText,
          replacementTiptapJson: richText.tiptapJson,
          label: "更新技能",
          changeSummary: args.changeSummary ?? "补充相关技能。",
        },
        writeMode,
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
  writeMode,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  toolCallId: string;
  toolName: string;
  args: FloatingSectionToolArgs;
  writeMode: AgentWriteMode;
}) {
  const operation = toResumeOperation(toolCallId, args);
  return executeResumeOperationTool({
    executedToolCalls,
    toolCallId,
    toolName,
    operation,
    input: args,
    writeMode,
  });
}

function executeResumeOperationTool({
  executedToolCalls,
  toolCallId,
  toolName,
  operation,
  input,
  writeMode,
}: {
  executedToolCalls: ExecutedFloatingToolCall[];
  toolCallId: string;
  toolName: string;
  operation: ResumeOperation | null;
  input: unknown;
  writeMode: AgentWriteMode;
}) {
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
        input,
        output,
        errorText: output.error,
      },
    });
    return output;
  }

  const output = {
    success: true,
    applied: writeMode === "direct",
    approvalRequired: writeMode === "approval",
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
      input,
      output,
    },
  });
  return output;
}

function createFloatingChatEventStream({
  fullStream,
  executedToolCalls,
  sessionId,
  writeMode,
}: {
  fullStream: AsyncIterable<FloatingStreamPart>;
  executedToolCalls: ExecutedFloatingToolCall[];
  sessionId: string | null;
  writeMode: AgentWriteMode;
}) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantMessage = "";
      let messageParts: FloatingMessagePart[] = [];
      const toolCalls = new Map<string, FloatingToolCall>();
      const approvalRequests = new Map<string, AgentOperationApprovalRequest>();
      const questions = new Map<string, FloatingQuestionRequest>();
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
      const finishResponse = async () => {
        const responseToolCalls = mergeToolCalls(
          [...toolCalls.values()],
          executedToolCalls.map(({ toolCall }) => toolCall),
        );
        const operations = executedToolCalls
          .map(({ operation }) => operation)
          .filter((operation): operation is ResumeOperation => operation !== null);
        const directOperations = writeMode === "approval" ? [] : operations;
        const responseApprovalRequests = [...approvalRequests.values()];
        const responseQuestions = [...questions.values()];
        const finalMessage =
          assistantMessage.trim() ||
          (responseQuestions.length > 0
            ? "我需要先补充一个信息，回答后我会继续。"
            : writeMode === "approval" && responseApprovalRequests.length > 0
            ? `我整理了 ${responseApprovalRequests.length} 条修改建议，请确认后应用。`
            : operations.length > 0
              ? `已根据你的要求修改 ${operations.length} 处简历内容。`
              : "我已经检查完这份简历。");
        const finalParts = finalizeFloatingMessageParts(
          messageParts,
          finalMessage,
          responseToolCalls,
          responseQuestions,
        );

        if (sessionId && (finalMessage.trim() || responseToolCalls.length > 0)) {
          await appendFloatingChatMessage({
            sessionId,
            role: "assistant",
            content: finalMessage,
            toolCalls: persistedToolCalls(responseToolCalls),
            operations: directOperations,
            parts: finalParts,
          });
        }

        send({
          type: "done",
          message: finalMessage,
          operations: directOperations,
          approvalRequests: responseApprovalRequests,
          questions: responseQuestions,
          toolCalls: responseToolCalls,
          parts: finalParts,
        });
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
            if (executed?.question) {
              questions.set(executed.question.id, executed.question);
              messageParts = upsertFloatingMessageQuestionPart(
                messageParts,
                executed.question,
              );
              sendToolEvent("tool-call-result", toolCall, []);
              send({ type: "question-request", question: executed.question });
              await finishResponse();
              return;
            }
            if (executed?.operation && writeMode === "approval") {
              const approvalRequest = createApprovalRequest(
                executed.operation,
                part.toolName,
              );
              approvalRequests.set(approvalRequest.id, approvalRequest);
              messageParts = upsertFloatingMessageApprovalPart(
                messageParts,
                approvalRequest,
              );
              sendToolEvent("tool-call-result", toolCall, []);
              send({ type: "approval-request", approvalRequest });
              await finishResponse();
              return;
            } else {
              sendToolEvent(
                "tool-call-result",
                toolCall,
                executed?.operation ? [executed.operation] : [],
              );
            }
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

        await finishResponse();
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

function createApprovalRequest(
  operation: ResumeOperation,
  toolName: string,
): AgentOperationApprovalRequest {
  return {
    id: operation.id,
    status: "pending",
    reason: "approval_required",
    message: operation.changeSummary || operation.label,
    toolCallId: operation.toolCallId || null,
    source: { kind: "tool", name: toolName },
    operation,
  };
}

function upsertFloatingMessageApprovalPart(
  parts: FloatingMessagePart[],
  approvalRequest: AgentOperationApprovalRequest,
): FloatingMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === "approval" && part.approvalRequest.id === approvalRequest.id,
  );
  if (index === -1) {
    return [
      ...parts,
      {
        id: `part_approval_${approvalRequest.id}`,
        type: "approval",
        approvalRequest,
      },
    ];
  }
  const next = [...parts];
  next[index] = {
    id: next[index].id,
    type: "approval",
    approvalRequest,
  };
  return next;
}

function upsertFloatingMessageQuestionPart(
  parts: FloatingMessagePart[],
  question: FloatingQuestionRequest,
): FloatingMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === "question" && part.question.id === question.id,
  );
  if (index === -1) {
    return [
      ...parts,
      {
        id: `part_question_${question.id}`,
        type: "question",
        question,
      },
    ];
  }
  const next = [...parts];
  next[index] = {
    id: next[index].id,
    type: "question",
    question,
  };
  return next;
}

function finalizeFloatingMessageParts(
  parts: FloatingMessagePart[],
  finalText: string,
  toolCalls: FloatingToolCall[],
  questions: FloatingQuestionRequest[] = [],
): FloatingMessagePart[] {
  let next = parts;
  for (const toolCall of toolCalls) {
    next = upsertFloatingMessageToolPart(next, toolCall);
  }
  for (const question of questions) {
    next = upsertFloatingMessageQuestionPart(next, question);
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

function readContextSectionOrder(context: unknown) {
  if (typeof context !== "object" || context === null) {
    return null;
  }
  const sectionOrder = (context as { sectionOrder?: unknown }).sectionOrder;
  if (!Array.isArray(sectionOrder)) {
    return null;
  }
  const cleanOrder = sectionOrder
    .map((key) => typeof key === "string" ? key.trim() : "")
    .filter((key): key is string => key.length > 0);
  return cleanOrder.length > 0 ? cleanOrder : null;
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "工具调用失败");
}

function toResumeOperation(
  toolCallId: string,
  args: FloatingSectionToolArgs,
): ResumeOperation | null {
  const fieldPath = resolveFieldPath(args);
  if (!fieldPath || args.afterPlainText === undefined) return null;
  const afterPlainText = args.afterPlainText;
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
    replacementValue: args.replacementValue,
    ...(args.replacementTiptapJson === undefined
      ? {}
      : { replacementTiptapJson: args.replacementTiptapJson }),
    changeSummary: args.changeSummary?.trim() || `更新 ${fieldPath}`,
    riskFlags: [],
  };
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeBlockFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return typeof value === "string" ? value.trim() : value;
}

function pickBlockValues(record: Record<string, unknown>, fields: string[]) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      values[field] = normalizeBlockFieldValue(record[field]);
    }
  }
  return values;
}

function summarizeBlockValues(values: Record<string, unknown>) {
  const text = Object.values(values)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(" / ");
  return text || Object.keys(values).join(" / ");
}

function sectionForModuleKey(moduleKey: string): ResumeOperation["section"] {
  if (
    moduleKey === "experience" ||
    moduleKey === "education" ||
    moduleKey === "projects" ||
    moduleKey === "research" ||
    moduleKey === "skills" ||
    moduleKey === "summary" ||
    moduleKey === "awards" ||
    moduleKey === "portfolio"
  ) {
    return moduleKey;
  }
  return "custom";
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

function customSectionFieldPath(sectionId: string, field?: "title" | "content") {
  const base = sectionId.trim().startsWith("custom.")
    ? sectionId.trim()
    : `custom.${sectionId.trim()}`;
  if (!field) return base;
  return base.endsWith(`.${field}`) ? base : `${base}.${field}`;
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
