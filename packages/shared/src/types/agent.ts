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

export type AgentToolName =
  | "resume_read"
  | "resume_update_section"
  | "resume_delete_section"
  | "resume_reorder_sections"
  | "resume_insert_section";

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
    | "summary"
    | "experience"
    | "projects"
    | "education"
    | "skills"
    | "research"
    | "custom";
  fieldPath: string;
  operation:
    | "update_section"
    | "delete_section"
    | "reorder_sections"
    | "insert_section";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  sectionOrder?: string[];
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
