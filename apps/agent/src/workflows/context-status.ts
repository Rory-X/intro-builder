import type { AgentMessageRequest } from "../agent-messages.js";

export type AgentContextStatusSnapshot = {
  effectiveInputBudgetTokens: number;
  modelInputLimitTokens: number;
  reservedOutputTokens: number;
  reservedSystemTokens: number;
  usedInputTokens: number;
  utilization: number;
  status: "healthy" | "near_limit" | "compacting" | "blocked";
  policy: "full_context" | "pinned_plus_recent" | "compacted_history";
  sources: Array<{
    id: string;
    label: string;
    kind:
      | "system"
      | "resume_snapshot"
      | "workspace_facts"
      | "change_sets"
      | "conversation_recent"
      | "conversation_summary"
      | "uploaded_source"
      | "tool_result"
      | "retrieved_memory";
    priority:
      | "required"
      | "pinned"
      | "working_set"
      | "summarizable"
      | "optional";
    tokenEstimate: number;
    included: boolean;
    treatment: "raw" | "summary" | "omitted";
  }>;
  lastCompactionAt: string | null;
  warnings: Array<{
    code:
      | "near_limit"
      | "summarized_history"
      | "omitted_low_priority_context"
      | "model_context_too_small"
      | "token_estimate_uncertain";
    message: string;
  }>;
};

export const MIN_EFFECTIVE_INPUT_CONTEXT_TOKENS = 200_000;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_000;
const DEFAULT_RESERVED_SYSTEM_TOKENS = 6_000;
const DEFAULT_MODEL_INPUT_LIMIT_TOKENS =
  MIN_EFFECTIVE_INPUT_CONTEXT_TOKENS +
  DEFAULT_RESERVED_OUTPUT_TOKENS +
  DEFAULT_RESERVED_SYSTEM_TOKENS;

export function buildAgentContextStatus(
  request: AgentMessageRequest,
): AgentContextStatusSnapshot {
  const systemTokens = DEFAULT_RESERVED_SYSTEM_TOKENS;
  const context = request.context;
  const resumeTokens = estimateTokens(
    context
      ? [
          context.resumeTitle,
          context.templateId,
          context.activeSection ?? "",
          ...context.sections.map(
            (section) =>
              `${section.label}\n${section.fieldPath}\n${section.plainText}`,
          ),
        ].join("\n")
      : "当前还没有可读取的简历快照。",
  );
  const conversationTokens = estimateTokens(
    request.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n"),
  );
  const qualityTokens = estimateTokens(
    context ? JSON.stringify(context.completeness) : "{}",
  );
  const usedInputTokens = systemTokens + resumeTokens + conversationTokens + qualityTokens;
  const utilization = roundUsage(
    usedInputTokens / MIN_EFFECTIVE_INPUT_CONTEXT_TOKENS,
  );
  const status = readStatus(utilization);

  return {
    effectiveInputBudgetTokens: MIN_EFFECTIVE_INPUT_CONTEXT_TOKENS,
    modelInputLimitTokens: DEFAULT_MODEL_INPUT_LIMIT_TOKENS,
    reservedOutputTokens: DEFAULT_RESERVED_OUTPUT_TOKENS,
    reservedSystemTokens: DEFAULT_RESERVED_SYSTEM_TOKENS,
    usedInputTokens,
    utilization,
    status,
    policy: status === "near_limit" ? "pinned_plus_recent" : "full_context",
    sources: [
      {
        id: "system",
        label: "系统指令",
        kind: "system",
        priority: "required",
        tokenEstimate: systemTokens,
        included: true,
        treatment: "raw",
      },
      {
        id: "resume_snapshot",
        label: context ? "当前简历" : "待创建简历",
        kind: "resume_snapshot",
        priority: "required",
        tokenEstimate: resumeTokens,
        included: Boolean(context),
        treatment: context ? "raw" : "omitted",
      },
      {
        id: "conversation_recent",
        label: "最近对话",
        kind: "conversation_recent",
        priority: "working_set",
        tokenEstimate: conversationTokens,
        included: true,
        treatment: "raw",
      },
      {
        id: "quality_status",
        label: "简历质量状态",
        kind: "workspace_facts",
        priority: "pinned",
        tokenEstimate: qualityTokens,
        included: Boolean(context),
        treatment: context ? "raw" : "omitted",
      },
    ],
    lastCompactionAt: null,
    warnings:
      status === "near_limit"
        ? [
            {
              code: "near_limit",
              message: "上下文接近上限，后续会优先保留当前简历和最近对话。",
            },
          ]
        : [],
  };
}

function estimateTokens(value: string): number {
  if (!value) return 0;
  return Math.max(1, Math.ceil(Array.from(value).length / 2));
}

function readStatus(
  utilization: number,
): AgentContextStatusSnapshot["status"] {
  if (utilization >= 1) return "blocked";
  if (utilization >= 0.9) return "compacting";
  if (utilization >= 0.7) return "near_limit";
  return "healthy";
}

function roundUsage(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
