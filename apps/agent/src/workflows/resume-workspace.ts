import type {
  AgentDraftResumeSnapshot,
  AgentMessageRequest,
  AgentMessageParseResult,
} from "../agent-messages.js";
import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";

export type AgentResumeWorkspaceSnapshot = {
  resumeId: string | null;
  mode: "optimize_existing" | "create_from_zero";
  goal: {
    workflowId: string | null;
    resumeTitle: string;
    targetRole: string | null;
    locale: "zh-CN";
  };
  facts: Array<{
    id: string;
    sectionKey: string;
    label: string;
    text: string;
    source: "resume_snapshot" | "user_answer" | "agent_inference";
    confidence: number;
  }>;
  draftResume: AgentDraftResumeSnapshot | null;
  changeSets: Array<{
    id: string;
    title: string;
    summary: string;
    status: "staged" | "partially_applied" | "applied" | "rejected" | "superseded";
    operationIds: string[];
    operations: ResumeOperation[];
    createdAt: string;
  }>;
  decisions: Array<{
    id: string;
    changeSetId: string;
    operationId: string | null;
    decision: "approved" | "rejected" | "answered";
    note: string | null;
    createdAt: string;
  }>;
  qualityReport: null | {
    score: number;
    summary: string;
    risks: Array<{
      code: "missing_fact" | "fabrication_risk" | "formatting_risk" | "low_impact";
      message: string;
    }>;
  };
  updatedAt: string;
};

type ParsedAgentResult = Extract<
  AgentMessageParseResult,
  { ok: true }
>["result"];

export function buildAgentResumeWorkspace({
  request,
  requestId,
  now = new Date().toISOString(),
  result,
}: {
  request: AgentMessageRequest;
  requestId: string;
  now?: string;
  result: ParsedAgentResult;
}): AgentResumeWorkspaceSnapshot {
  const context = request.context;
  const draftResume = result.draftResume ?? null;
  return {
    resumeId: request.resumeId,
    mode: request.mode ?? "optimize_existing",
    goal: {
      workflowId: request.workflowId,
      resumeTitle: draftResume?.title ?? context?.resumeTitle ?? "新简历",
      targetRole: draftResume?.targetRole ?? null,
      locale: request.locale,
    },
    facts: context ? buildResumeSnapshotFacts(context) : buildDraftResumeFacts(draftResume),
    draftResume,
    changeSets: buildChangeSets(requestId, now, result.proposedOperations),
    decisions: [],
    qualityReport: buildQualityReport(result.toolCalls),
    updatedAt: now,
  };
}

function buildResumeSnapshotFacts(
  context: NonNullable<AgentMessageRequest["context"]>,
): AgentResumeWorkspaceSnapshot["facts"] {
  return context.sections
    .filter((section) => section.plainText.trim() !== "")
    .map((section, index) => ({
      id: `fact_${safeId(section.key)}_${index + 1}`,
      sectionKey: section.key,
      label: section.label,
      text: section.plainText,
      source: "resume_snapshot",
      confidence: 1,
    }));
}

function buildDraftResumeFacts(
  draftResume: AgentDraftResumeSnapshot | null,
): AgentResumeWorkspaceSnapshot["facts"] {
  if (!draftResume) return [];

  const facts: AgentResumeWorkspaceSnapshot["facts"] = [];
  if (draftResume.targetRole) {
    facts.push({
      id: "fact_target_role",
      sectionKey: "goal",
      label: "目标岗位",
      text: draftResume.targetRole,
      source: "user_answer",
      confidence: 1,
    });
  }
  if (draftResume.profileSummary.trim()) {
    facts.push({
      id: "fact_basic_profile",
      sectionKey: "basics",
      label: "基础资料",
      text: draftResume.profileSummary,
      source: "user_answer",
      confidence: 1,
    });
  }

  return facts;
}

function buildChangeSets(
  requestId: string,
  now: string,
  operations: ResumeOperation[],
): AgentResumeWorkspaceSnapshot["changeSets"] {
  if (operations.length === 0) return [];

  return [
    {
      id: `changeset_${safeId(requestId)}`,
      title: "待确认修改",
      summary: summarizeOperations(operations),
      status: "staged",
      operationIds: operations.map((operation) => operation.id),
      operations,
      createdAt: now,
    },
  ];
}

function summarizeOperations(operations: ResumeOperation[]): string {
  const summaries = operations
    .map((operation) => operation.changeSummary.trim())
    .filter(Boolean);
  if (summaries.length === 0) return `包含 ${operations.length} 条修改建议`;
  return summaries.join("；");
}

function buildQualityReport(
  toolCalls: AgentToolCall[],
): AgentResumeWorkspaceSnapshot["qualityReport"] {
  const risks: NonNullable<AgentResumeWorkspaceSnapshot["qualityReport"]>["risks"] = [];
  const scores: number[] = [];

  for (const toolCall of toolCalls) {
    const score = readNumericScore(toolCall.result);
    if (score !== null) scores.push(score);
    const rawRisks = Array.isArray(toolCall.result.risks)
      ? toolCall.result.risks
      : [];
    for (const rawRisk of rawRisks) {
      if (!isRecord(rawRisk) || typeof rawRisk.message !== "string") continue;
      const code = mapQualityRiskCode(rawRisk.code);
      if (!code) continue;
      risks.push({ code, message: rawRisk.message });
    }
  }

  if (risks.length === 0 && scores.length === 0) return null;
  const score =
    scores.length > 0
      ? Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length)
      : Math.max(0, 100 - risks.length * 15);
  return {
    score,
    summary:
      risks.length > 0
        ? `发现 ${risks.length} 个质量风险。`
        : "未发现明显质量风险。",
    risks,
  };
}

function readNumericScore(result: Record<string, unknown>): number | null {
  const score = typeof result.score === "number" ? result.score : null;
  if (score !== null) return clampScore(score);
  const overall = typeof result.overall === "number" ? result.overall : null;
  return overall === null ? null : clampScore(overall);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function mapQualityRiskCode(
  code: unknown,
): NonNullable<AgentResumeWorkspaceSnapshot["qualityReport"]>["risks"][number]["code"] | null {
  if (code === "possible_fabrication") return "fabrication_risk";
  if (code === "missing_keyword" || code === "weak_structure") return "low_impact";
  if (code === "content_overflow") return "formatting_risk";
  if (code === "missing_fact") return "missing_fact";
  if (
    code === "fabrication_risk" ||
    code === "formatting_risk" ||
    code === "low_impact"
  ) {
    return code;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
