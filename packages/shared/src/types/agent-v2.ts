import type { AgentWorkflowId, ResumeOperation } from "./agent";

export type AgentContextStatus =
  | "healthy"
  | "near_limit"
  | "compacting"
  | "blocked";

export type AgentContextPolicy =
  | "full_context"
  | "pinned_plus_recent"
  | "compacted_history";

export type AgentContextSourceStatus = {
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
};

export type AgentContextWarning = {
  code:
    | "near_limit"
    | "summarized_history"
    | "omitted_low_priority_context"
    | "model_context_too_small"
    | "token_estimate_uncertain";
  message: string;
};

export type AgentContextStatusSnapshot = {
  effectiveInputBudgetTokens: number;
  modelInputLimitTokens: number;
  reservedOutputTokens: number;
  reservedSystemTokens: number;
  usedInputTokens: number;
  utilization: number;
  status: AgentContextStatus;
  policy: AgentContextPolicy;
  sources: AgentContextSourceStatus[];
  lastCompactionAt: string | null;
  warnings: AgentContextWarning[];
};

export type AgentResumeSessionMode = "optimize_existing" | "create_from_zero";

export type AgentResumeWorkspaceGoal = {
  workflowId: string | null;
  resumeTitle: string;
  targetRole: string | null;
  locale: "zh-CN";
};

export type AgentResumeFact = {
  id: string;
  sectionKey: string;
  label: string;
  text: string;
  source: "resume_snapshot" | "user_answer" | "agent_inference";
  confidence: number;
};

export type AgentResumeChangeSetStatus =
  | "staged"
  | "partially_applied"
  | "applied"
  | "rejected"
  | "superseded";

export type AgentResumeChangeSet = {
  id: string;
  title: string;
  summary: string;
  status: AgentResumeChangeSetStatus;
  operationIds: string[];
  operations: ResumeOperation[];
  createdAt: string;
};

export type AgentUserDecision = {
  id: string;
  changeSetId: string;
  operationId: string | null;
  decision: "approved" | "rejected" | "answered";
  note: string | null;
  createdAt: string;
};

export type AgentResumeQualityReport = {
  score: number;
  summary: string;
  risks: Array<{
    code: "missing_fact" | "fabrication_risk" | "formatting_risk" | "low_impact";
    message: string;
  }>;
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

export type AgentResumeWorkspaceSnapshot = {
  resumeId: string | null;
  mode: AgentResumeSessionMode;
  goal: AgentResumeWorkspaceGoal;
  facts: AgentResumeFact[];
  draftResume: AgentDraftResumeSnapshot | null;
  changeSets: AgentResumeChangeSet[];
  decisions: AgentUserDecision[];
  qualityReport: AgentResumeQualityReport | null;
  updatedAt: string;
};

export type AgentSessionStatus =
  | "active"
  | "waiting_user"
  | "completed"
  | "cancelled"
  | "failed";

export type AgentWorkflowCursor = {
  workflowId: AgentWorkflowId | "create-from-zero" | null;
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
