export type AgentWorkflowId =
  | "resume-diagnose"
  | "target-role-match"
  | "experience-star"
  | "pre-export-check";

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

export type AgentMessageRequest = {
  resumeId: string;
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  messages: AgentChatMessage[];
  context: AgentResumeContext;
};

export type AgentToolName =
  | "inspect_resume"
  | "propose_rich_text_rewrite"
  | "propose_summary_rewrite"
  | "propose_bullet_rewrite"
  | "draft_section_item";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type ResumePatch = {
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
  operation: "replace_plain_text" | "replace_tiptap_json";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  changeSummary: string;
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
  proposedPatches: ResumePatch[];
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};
