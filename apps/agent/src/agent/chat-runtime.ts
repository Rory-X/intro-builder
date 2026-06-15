import {
  convertToModelMessages,
  stepCountIs,
  streamText as defaultStreamText,
  type LanguageModel,
  type StreamTextOnFinishCallback,
  type TelemetrySettings,
  type UIMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { AgentResumeSessionMode } from "../agent-messages.js";
import { createAgentTools, type AgentTools, type ResumeReader } from "./tools.js";
import type { PreviewState } from "./preview.js";

/**
 * Agent chat runtime. Wires the AI SDK multi-step tool loop and returns a
 * standard AI SDK UI message stream `Response` — the core SSE contract the web
 * (assistant-ui on the AI SDK runtime) consumes. Write tools mutate `preview`;
 * the real resume is only touched on apply (web side).
 */

export const CHAT_MAX_STEPS = 16;

export function createChatModel(settings: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}): LanguageModel {
  return createOpenAICompatible({
    name: "intro-openai-compatible",
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    includeUsage: true,
  })(settings.modelName);
}

export function buildChatSystemPrompt(input: {
  mode: AgentResumeSessionMode;
  targetRole?: string | null;
  locale?: string;
}): string {
  const locale = input.locale ?? "zh-CN";
  const intro =
    input.mode === "create_from_zero"
      ? "你正在帮用户【从零创建】一份中文简历。"
      : "你正在帮用户【优化已有】的中文简历，先用 read_resume 读取现状再动手。";
  return [
    "你是 intro-builder 的简历共创助手。",
    intro,
    "你在一个预览（preview）沙盒里工作：所有写入只改预览，绝不直接改用户的真实简历。",
    "",
    "工作方式（多步循环）：",
    "1. 需要时先用 read_resume 读真实简历，用 set_goal 记录标题与目标岗位。",
    "2. 逐段用 upsert_section 把内容写进预览。",
    "3. 只依据用户提供或简历已有的事实写作；缺关键信息时用 ask_user 询问，不要编造。",
    "4. 完成后停止调用工具，用一两句话说明你做了什么、还缺什么。",
    "",
    "真实简历的改动只会在用户点击「应用」后由系统落盘，你无需也无法直接落盘。",
    input.targetRole ? `目标岗位：${input.targetRole}。` : "若不知道目标岗位，先询问或从对话推断。",
    `语言：${locale}。`,
  ].join("\n");
}

export type StreamAgentChatOptions = {
  model: LanguageModel;
  mode: AgentResumeSessionMode;
  messages: UIMessage[];
  preview: PreviewState;
  readResume: ResumeReader;
  targetRole?: string | null;
  locale?: string;
  telemetry?: TelemetrySettings;
  maxSteps?: number;
  onFinish?: StreamTextOnFinishCallback<AgentTools>;
  /** Injectable for tests; defaults to the real AI SDK streamText. */
  streamTextImpl?: typeof defaultStreamText;
};

export async function streamAgentChat(
  options: StreamAgentChatOptions,
): Promise<Response> {
  const {
    model,
    mode,
    messages,
    preview,
    readResume,
    targetRole,
    locale,
    telemetry,
    maxSteps = CHAT_MAX_STEPS,
    onFinish,
    streamTextImpl = defaultStreamText,
  } = options;

  const tools = createAgentTools({ preview, readResume });
  const modelMessages = await convertToModelMessages(messages);
  const result = streamTextImpl({
    model,
    system: buildChatSystemPrompt({ mode, targetRole, locale }),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(telemetry ? { experimental_telemetry: telemetry } : {}),
    ...(onFinish ? { onFinish } : {}),
  });

  return result.toUIMessageStreamResponse();
}
