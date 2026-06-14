import {
  stepCountIs,
  streamText as defaultStreamText,
  type LanguageModel,
  type ModelMessage,
  type TelemetrySettings,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type {
  AgentMessageParseResult,
  AgentMessageRequest,
} from "../agent-messages.js";
import {
  createDraft,
  draftSnapshot,
  rehydrateDraft,
  type DraftState,
} from "./draft.js";
import { createLoopTools } from "./tools.js";

/**
 * 真 agent loop 执行器（create-from-zero）。
 *
 * 用 AI SDK v6 的多步工具循环（`streamText` + `tools` + `stopWhen(stepCountIs)`）
 * 驱动模型：读工具读 draft、写工具改 draft，模型读到结果再决策，直到不再调工具或
 * 触达步数上限。loop 内绝不写真简历——只攒 draft。结束后 {@link assembleLoopResult}
 * 把 draft 装配成标准 `ParsedAgentResult`，复用既有 `toStreamingRuntimeTailEvents`
 * 出工具事件 / workspace / change-set 预览。
 *
 * 系统提示词参考 LingyiChen-AI/JadeAI（Apache-2.0）的 resume 助手提示结构。
 */

export const LOOP_MAX_STEPS = 16;

type ParsedLoopResult = Extract<
  AgentMessageParseResult,
  { ok: true }
>["result"];

export function createLoopModel(settings: {
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

export function buildLoopSystemPrompt(request: AgentMessageRequest): string {
  const targetRole =
    request.sessionSnapshot?.workspace.goal.targetRole ??
    request.sessionSnapshot?.workspace.draftResume?.targetRole ??
    null;
  return [
    "你是 intro-builder 的简历共创助手，正在帮用户【从零创建】一份中文简历。",
    "你在一个草稿（draft）沙盒里工作：所有写入只改草稿，绝不直接改用户的真实简历。",
    "",
    "工作方式（多步循环）：",
    "1. 先用 resume_read 看当前草稿；用 set_goal 记录标题与目标岗位。",
    "2. 逐段用 upsert_section 把内容写进草稿；写完用 get_completeness 自检，再决定下一步。",
    "3. 只依据用户提供的事实写作，缺关键信息时不要编造——把该段标为 needs_user_fact，并在最后用一句话请用户补充。",
    "4. 全部就绪后，停止调用工具，用一两句话向用户说明你做了什么、还缺什么。",
    "",
    "草稿之外的真实简历改动只会在用户点击「同意应用」后由系统落盘，你无需也无法直接落盘。",
    targetRole ? `目标岗位：${targetRole}。` : "如果还不知道目标岗位，先询问或从对话中推断。",
    `语言：${request.locale}。`,
  ].join("\n");
}

export type RunResumeLoopOptions = {
  model: LanguageModel;
  request: AgentMessageRequest;
  draft: DraftState;
  maxSteps?: number;
  onTextDelta?: (delta: string) => void;
  /** Langfuse/OTel telemetry forwarded to streamText so the loop is traced. */
  telemetry?: TelemetrySettings;
  /** Injectable for tests; defaults to the real AI SDK streamText. */
  streamTextImpl?: typeof defaultStreamText;
};

export type RunResumeLoopResult = {
  text: string;
};

export async function runResumeLoop(
  options: RunResumeLoopOptions,
): Promise<RunResumeLoopResult> {
  const {
    model,
    request,
    draft,
    maxSteps = LOOP_MAX_STEPS,
    onTextDelta,
    telemetry,
    streamTextImpl = defaultStreamText,
  } = options;

  const tools = createLoopTools(draft);
  const result = streamTextImpl({
    model,
    system: buildLoopSystemPrompt(request),
    messages: toModelMessages(request),
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(telemetry ? { experimental_telemetry: telemetry } : {}),
  });

  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    onTextDelta?.(delta);
  }

  return {
    text: text.trim() || "已根据你的输入更新草稿，请在右侧预览中查看。",
  };
}

/**
 * Assemble the loop's accumulated draft into the standard parse-result shape so
 * the existing AG-UI event/workspace builders can render tool calls + change-set.
 */
export function assembleLoopResult(input: {
  draft: DraftState;
  finalText: string;
  requestId: string;
}): ParsedLoopResult {
  const { draft, finalText, requestId } = input;
  return {
    message: {
      id: `msg_${requestId}`,
      role: "assistant",
      content: finalText,
    },
    toolCalls: draft.toolCalls,
    proposedOperations: draft.operations,
    draftResume: draftSnapshot(draft),
  };
}

export function createInitialLoopDraft(request: AgentMessageRequest): DraftState {
  const workspace = request.sessionSnapshot?.workspace ?? null;
  if (workspace && (workspace.draftResume || workspace.changeSets.length > 0)) {
    return rehydrateDraft(workspace);
  }
  const snapshot = workspace?.draftResume ?? null;
  return createDraft({
    title: snapshot?.title ?? request.context?.resumeTitle,
    targetRole: snapshot?.targetRole ?? null,
  });
}

function toModelMessages(request: AgentMessageRequest): ModelMessage[] {
  return request.messages.map((message) =>
    message.role === "assistant"
      ? { role: "assistant", content: message.content }
      : { role: "user", content: message.content },
  );
}
