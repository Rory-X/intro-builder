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
import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";
import {
  createDraft,
  draftSnapshot,
  rehydrateDraft,
  type DraftState,
} from "./draft.js";
import { createLoopTools, type LoopToolsFactoryOptions } from "./tools.js";

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
  const isCreateFromZero = request.mode === "create_from_zero";

  if (isCreateFromZero) {
    return [
      "你是 intro-builder 的简历共创助手，正在帮用户【从零创建】一份中文简历。",
      "你在一个草稿（draft）沙盒里工作：所有写入只改草稿，绝不直接改用户的真实简历。",
      "",
      "工作方式（多步循环）：",
      "1. 先用 resume_read 看当前草稿；用 set_goal 记录标题与目标岗位。",
      "2. 逐段用 resume_set_text / resume_update_section 把内容写进草稿；写完用 get_completeness 自检。",
      "3. 只依据用户提供的事实写作。缺关键信息时用 resume_ask 追问用户，不要编造。",
      "4. 把缺信息的段标为 needs_user_fact，最后提醒用户补充。",
      "5. 全部就绪后停止调工具，用一两句话总结做了什么、还缺什么。",
      "",
      "草稿之外的真实简历改动只会在用户点击「同意应用」后由系统落盘。",
      targetRole
        ? `目标岗位：${targetRole}。`
        : "如果不知道目标岗位，先用 set_goal 记录或 resume_ask 询问。",
      `语言：${request.locale}。`,
    ].join("\n");
  }

  return [
    "你是 intro-builder 的简历优化助手，正在帮用户【优化已有简历】。",
    "你在一个草稿（draft）沙盒里工作：所有写入只改草稿，绝不直接改用户的真实简历。",
    "",
    "工作方式（多步循环）：",
    "1. 先用 resume_read 读取整个草稿了解简历全貌。",
    "2. 用 get_completeness 检查完整度。",
    "3. 使用 resume_polish_text 逐段优化需要改善的地方。",
    "4. 需要结构性修改时使用 resume_update_section / resume_delete_section / resume_insert_section / resume_reorder_sections。",
    "5. 需要用户补充信息时用 resume_ask 追问。不要编造事实、数字、公司名、奖项。",
    "6. 完成后停止调工具，用一两句话总结做了什么。",
    "",
    "STAR 原则优化时不得编造 Result 指标。原文是列表结构时润色结果必须保持列表。",
    "草稿之外的真实简历改动只会在用户点击「同意应用」后由系统落盘。",
    targetRole ? `目标岗位：${targetRole}。` : "",
    `语言：${request.locale}。`,
  ].join("\n");
}

export type RunResumeLoopResult = {
  text: string;
  isAskPending: boolean;
};

export type LoopStepEvent = {
  step: number;
  toolCalls: Array<{
    toolCall: AgentToolCall;
    proposedOperations: ResumeOperation[];
  }>;
};

export type RunResumeLoopOptions = {
  model: LanguageModel;
  request: AgentMessageRequest;
  draft: DraftState;
  maxSteps?: number;
  onTextDelta?: (delta: string) => void;
  onStepFinish?: (event: LoopStepEvent) => void;
  telemetry?: TelemetrySettings;
  streamTextImpl?: typeof defaultStreamText;
  loopToolsOptions?: LoopToolsFactoryOptions;
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
    onStepFinish,
    telemetry,
    streamTextImpl = defaultStreamText,
    loopToolsOptions,
  } = options;

  let isAskPending = false;
  const tools = createLoopTools(draft, {
    ...loopToolsOptions,
    onAsk: (_question, _field) => {
      isAskPending = true;
    },
  });

  const result = streamTextImpl({
    model,
    system: buildLoopSystemPrompt(request),
    messages: toModelMessages(request),
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(telemetry ? { experimental_telemetry: telemetry } : {}),
    onStepFinish: (step: {
      stepNumber: number;
      toolCalls?: Array<{
        toolName?: string;
        toolCallId?: string;
      }>;
    }) => {
      if (!onStepFinish) return;
      const toolCalls: LoopStepEvent["toolCalls"] = [];
      const stepToolCalls = step.toolCalls ?? [];
      const draftToolCallsSnapshot = [...draft.toolCalls];
      for (const stepTc of stepToolCalls) {
        if (stepTc.toolName === "resume_ask") continue;
        const draftTc = draftToolCallsSnapshot.find(
          (dtc) => dtc.id === stepTc.toolCallId,
        );
        if (!draftTc) continue;
        const operations = draft.operations.filter(
          (op) => op.toolCallId === draftTc.id,
        );
        toolCalls.push({
          toolCall: draftTc,
          proposedOperations: operations,
        });
      }
      if (toolCalls.length > 0) {
        onStepFinish({ step: step.stepNumber, toolCalls });
      }
    },
  });

  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    onTextDelta?.(delta);
  }

  return {
    text:
      text.trim() || "已根据你的输入更新草稿，请在右侧预览中查看。",
    isAskPending,
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
