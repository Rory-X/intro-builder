import type { AgentSessionSnapshot } from "./agent-v2";

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

export type AgentResumeContext = {
  resumeTitle: string;
  templateId: string;
  activeSection: string | null;
  sectionOrder?: string[];
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

export type AgentModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export type AgentWriteMode = "direct" | "approval";

export type AgentRunSessionContext = {
  sessionId: string;
  threadId: string;
  resumeId: string | null;
  mode: "optimize_existing" | "create_from_zero";
  workflowId: AgentWorkflowId | null;
  resumeTitle: string;
};

export type AgentMessageRequest = {
  resumeId: string | null;
  mode?: "optimize_existing" | "create_from_zero";
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  messages: AgentChatMessage[];
  context: AgentResumeContext | null;
  modelConfig?: AgentModelConfig;
  sessionContext?: AgentRunSessionContext;
  sessionSnapshot?: AgentSessionSnapshot;
};

export type AgentVisibleOperationToolName =
  | "resume_read"
  | "resume_update_section"
  | "resume_delete_section"
  | "resume_reorder_sections"
  | "resume_insert_section"
  | "resume_polish_text"
  | "resume_set_text"
  | "resume_ask";

export type AgentInternalLoopToolName =
  | AgentVisibleOperationToolName
  | "get_completeness"
  | "set_goal"
  | "role_match_read"
  | "ats_check"
  | "content_claim_audit"
  | "layout_fit_check"
  | "section_quality_score";

export type AgentToolName = AgentInternalLoopToolName;

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type ResumeOperation = {
  id: string;
  toolCallId: string;
  label: string;
  section:
    | "basics"
    | "summary"
    | "experience"
    | "projects"
    | "education"
    | "skills"
    | "research"
    | "awards"
    | "portfolio"
    | "custom"
    | "style";
  fieldPath: string;
  operation:
    | "update_section"
    | "delete_section"
    | "reorder_sections"
    | "insert_section"
    | "reorder_items";
  beforePlainText: string;
  afterPlainText: string;
  replacementValue?: unknown;
  replacementTiptapJson?: unknown;
  sectionOrder?: string[];
  itemOrder?: Array<number | string>;
  changeSummary: string;
  diagnosis?: string;
  riskFlags: Array<{
    type:
      | "needs_user_fact"
      | "possible_fabrication"
      | "formatting_risk"
      | "unsafe_claim";
    message: string;
  }>;
};

export type AgentOperationApprovalRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: "approval_required";
  message: string;
  toolCallId: string | null;
  source: { kind: "tool" | "skill"; name: string };
  operation: ResumeOperation;
};

export type AgentMessageResponse = {
  status: "ok";
  requestId: string;
  message: {
    id: string;
    role: "assistant";
    content: string;
  };
  toolCalls: AgentToolCall[];
  proposedOperations: ResumeOperation[];
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
  cached?: true;
  cachedAt?: string;
};
