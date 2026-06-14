import type {
  AgentDraftResumeSnapshot,
  AgentMessageProvider,
  AgentMessageRequest,
  AgentMessageProviderRunOptions,
  AgentMessageProviderRunResult,
} from "../agent-messages.js";
import type { AgentConfig } from "../config.js";

const DEV_PREVIEW_USAGE = {
  provider: "intro-dev-preview",
  model: "agent-v2-preview",
  inputTokens: 0,
  outputTokens: 0,
} as const;

export function createDevelopmentAgentMessageProvider(
  config: AgentConfig,
): AgentMessageProvider | undefined {
  if (config.nodeEnv !== "development") return undefined;

  return {
    async run(options) {
      return buildDevelopmentPreviewResult(options);
    },
  };
}

function buildDevelopmentPreviewResult({
  request,
  requestId,
}: AgentMessageProviderRunOptions): AgentMessageProviderRunResult {
  const reviewDecision = readLatestReviewDecision(request);
  const answers = readLatestQuestionAnswers(request);
  const answer = answers.get("question_target_role") ?? null;
  const basicProfileAnswer = answers.get("question_basic_profile") ?? null;
  const skillHighlightsAnswer = answers.get("question_skills_highlights") ?? null;
  const draftReviewAnswer = answers.get("question_draft_review") ?? null;
  const createZeroFactAnswers = readCreateZeroFactAnswers(answers);

  return {
    content: JSON.stringify(
      request.mode === "create_from_zero" && draftReviewAnswer
        ? buildCreateFromZeroFinalReviewResponse({
            request,
            requestId,
            answer: draftReviewAnswer,
          })
        : request.mode === "create_from_zero" && skillHighlightsAnswer
        ? buildCreateFromZeroSkillDraftResponse({
            request,
            requestId,
            answer: skillHighlightsAnswer,
          })
        : request.mode === "create_from_zero" && hasCreateZeroFactAnswers(createZeroFactAnswers)
        ? buildCreateFromZeroFactDraftResponse({
            request,
            requestId,
            answers: createZeroFactAnswers,
          })
        : request.mode === "create_from_zero" && answer && basicProfileAnswer
        ? buildCreateFromZeroDraftResponse({
            requestId,
            targetRole: answer,
            profileSummary: basicProfileAnswer,
          })
        : request.mode === "create_from_zero" && !answer && !reviewDecision
        ? buildCreateFromZeroQuestionResponse(requestId)
        : reviewDecision
        ? buildReviewedChangeResponse({ requestId, reviewDecision })
        : answer
        ? buildStagedChangeResponse({ request, requestId, answer })
        : buildQuestionResponse(requestId),
    ),
    usage: DEV_PREVIEW_USAGE,
  };
}

function buildCreateFromZeroFinalReviewResponse({
  request,
  requestId,
  answer,
}: {
  request: AgentMessageRequest;
  requestId: string;
  answer: string;
}) {
  const confirmation = answer.replace(/[。.!！?？\s]+$/u, "");

  return {
    message: {
      id: `msg_dev_create_zero_final_review_${safeId(requestId)}`,
      role: "assistant",
      content: `草稿方向已确认：${confirmation}。本地预览已经完成从 0 创建简历的长流程；下一步会进入可确认的写入/应用设计，但当前仍不会直接改写简历。`,
    },
    toolCalls: [],
    proposedOperations: [],
    questions: [],
    draftResume: request.sessionSnapshot?.workspace.draftResume ?? undefined,
  };
}

function buildCreateFromZeroSkillDraftResponse({
  request,
  requestId,
  answer,
}: {
  request: AgentMessageRequest;
  requestId: string;
  answer: string;
}) {
  const draftResume = mergeCreateZeroSkillAnswer({
    previous: request.sessionSnapshot?.workspace.draftResume ?? null,
    answer,
  });

  return {
    message: {
      id: `msg_dev_create_zero_skill_draft_${safeId(requestId)}`,
      role: "assistant",
      content:
        "已把技能亮点合并进简历草稿。现在草稿已经具备基础信息、经历、项目、教育和技能骨架，最后确认重点和语气后再进入可应用版本。",
    },
    toolCalls: [],
    proposedOperations: [],
    questions: [
      {
        id: "question_draft_review",
        message:
          "请确认这份草稿的重点和语气：是否更偏技术深度、业务增长、协作推动，或者还有必须强调/避免的内容？",
        field: "draft.review",
        responseSchema: {
          type: "object",
          properties: {
            answer: { type: "string", minLength: 1 },
          },
          required: ["answer"],
        },
      },
    ],
    draftResume,
  };
}

function buildCreateFromZeroFactDraftResponse({
  request,
  requestId,
  answers,
}: {
  request: AgentMessageRequest;
  requestId: string;
  answers: CreateZeroFactAnswers;
}) {
  const draftResume = mergeCreateZeroFactAnswers({
    previous: request.sessionSnapshot?.workspace.draftResume ?? null,
    answers,
  });

  return {
    message: {
      id: `msg_dev_create_zero_fact_draft_${safeId(requestId)}`,
      role: "assistant",
      content:
        "已把这些事实合并进简历草稿。下一步我需要确认技能关键词和最想突出的能力，避免草稿变成流水账。",
    },
    toolCalls: [],
    proposedOperations: [],
    questions: [
      {
        id: "question_skills_highlights",
        message:
          "请补充技能关键词和最想突出的 2-3 个能力，例如技术栈、业务能力、协作方式或行业经验。",
        field: "skills.primary",
        responseSchema: {
          type: "object",
          properties: {
            answer: { type: "string", minLength: 1 },
          },
          required: ["answer"],
        },
      },
    ],
    draftResume,
  };
}

function buildCreateFromZeroDraftResponse({
  requestId,
  targetRole,
  profileSummary,
}: {
  requestId: string;
  targetRole: string;
  profileSummary: string;
}) {
  return {
    message: {
      id: `msg_dev_create_zero_draft_${safeId(requestId)}`,
      role: "assistant",
      content:
        "我先生成一份简历草稿，当前只使用你刚刚提供的信息；经历、项目和教育背景还需要继续补充事实后再写入。",
    },
    toolCalls: [],
    proposedOperations: [],
    questions: buildCreateFromZeroFactQuestions(),
    draftResume: {
      title: `${targetRole}简历草稿`,
      targetRole,
      profileSummary,
      sections: [
        {
          key: "basics",
          label: "基础信息",
          summary: profileSummary,
          status: "drafted",
        },
        {
          key: "experience",
          label: "工作经历",
          summary: "等待补充真实经历事实、业务目标、行动和结果。",
          status: "needs_user_fact",
        },
        {
          key: "projects",
          label: "项目经历",
          summary: "等待补充项目背景、职责、技术栈和可验证结果。",
          status: "needs_user_fact",
        },
        {
          key: "education",
          label: "教育背景",
          summary: "等待补充学校、专业、学历和时间信息。",
          status: "needs_user_fact",
        },
      ],
      missingFacts: ["工作经历", "项目经历", "教育背景"],
    },
  };
}

function buildCreateFromZeroFactQuestions() {
  return [
    {
      id: "question_recent_experience",
      message:
        "请补充最近一段经历：所在公司/组织、岗位、时间、负责的业务目标、你做了什么、结果如何。",
      field: "experience.primary",
      responseSchema: {
        type: "object",
        properties: {
          answer: { type: "string", minLength: 1 },
        },
        required: ["answer"],
      },
    },
    {
      id: "question_project_example",
      message:
        "请补充一个最能代表目标岗位能力的项目：背景、你的职责、技术/方法、可验证结果。",
      field: "projects.primary",
      responseSchema: {
        type: "object",
        properties: {
          answer: { type: "string", minLength: 1 },
        },
        required: ["answer"],
      },
    },
    {
      id: "question_education",
      message: "请补充教育背景：学校、专业、学历、时间，以及可选的课程/奖项/排名。",
      field: "education.primary",
      responseSchema: {
        type: "object",
        properties: {
          answer: { type: "string", minLength: 1 },
        },
        required: ["answer"],
      },
    },
  ];
}

type CreateZeroFactAnswers = {
  experience: string | null;
  project: string | null;
  education: string | null;
};

function readCreateZeroFactAnswers(
  answers: Map<string, string>,
): CreateZeroFactAnswers {
  return {
    experience: answers.get("question_recent_experience") ?? null,
    project: answers.get("question_project_example") ?? null,
    education: answers.get("question_education") ?? null,
  };
}

function hasCreateZeroFactAnswers(answers: CreateZeroFactAnswers): boolean {
  return Boolean(answers.experience || answers.project || answers.education);
}

function mergeCreateZeroSkillAnswer({
  previous,
  answer,
}: {
  previous: AgentDraftResumeSnapshot | null;
  answer: string;
}): AgentDraftResumeSnapshot {
  const profileSummary = previous?.profileSummary?.trim() || "基础资料待补充";
  const sections = [
    ...(previous?.sections ?? []).filter((section) => section.key !== "skills"),
    {
      key: "skills",
      label: "技能亮点",
      summary: answer,
      status: "drafted" as const,
    },
  ];

  return {
    title: previous?.title ?? "新简历草稿",
    targetRole: previous?.targetRole ?? null,
    profileSummary,
    sections,
    missingFacts: (previous?.missingFacts ?? []).filter(
      (fact) => fact !== "技能亮点" && fact !== "技能" && fact !== "技能关键词",
    ),
  };
}

function mergeCreateZeroFactAnswers({
  previous,
  answers,
}: {
  previous: AgentDraftResumeSnapshot | null;
  answers: CreateZeroFactAnswers;
}): AgentDraftResumeSnapshot {
  const previousSections = previous?.sections ?? [];
  const profileSummary = previous?.profileSummary?.trim() || "基础资料待补充";
  const sections = [
    readDraftSection(previousSections, {
      key: "basics",
      label: "基础信息",
      summary: profileSummary,
      status: previous?.profileSummary?.trim() ? "drafted" : "needs_user_fact",
    }),
    mergeAnsweredSection(previousSections, {
      key: "experience",
      label: "工作经历",
      fallbackSummary: "等待补充真实经历事实、业务目标、行动和结果。",
      answer: answers.experience,
    }),
    mergeAnsweredSection(previousSections, {
      key: "projects",
      label: "项目经历",
      fallbackSummary: "等待补充项目背景、职责、技术栈和可验证结果。",
      answer: answers.project,
    }),
    mergeAnsweredSection(previousSections, {
      key: "education",
      label: "教育背景",
      fallbackSummary: "等待补充学校、专业、学历和时间信息。",
      answer: answers.education,
    }),
  ];

  return {
    title: previous?.title ?? "新简历草稿",
    targetRole: previous?.targetRole ?? null,
    profileSummary,
    sections,
    missingFacts: sections
      .filter(
        (section) =>
          section.status === "needs_user_fact" &&
          (section.key === "experience" ||
            section.key === "projects" ||
            section.key === "education"),
      )
      .map((section) => section.label),
  };
}

function mergeAnsweredSection(
  sections: AgentDraftResumeSnapshot["sections"],
  {
    key,
    label,
    fallbackSummary,
    answer,
  }: {
    key: string;
    label: string;
    fallbackSummary: string;
    answer: string | null;
  },
): AgentDraftResumeSnapshot["sections"][number] {
  if (answer) {
    return {
      key,
      label,
      summary: answer,
      status: "drafted",
    };
  }

  return readDraftSection(sections, {
    key,
    label,
    summary: fallbackSummary,
    status: "needs_user_fact",
  });
}

function readDraftSection(
  sections: AgentDraftResumeSnapshot["sections"],
  fallback: AgentDraftResumeSnapshot["sections"][number],
): AgentDraftResumeSnapshot["sections"][number] {
  return sections.find((section) => section.key === fallback.key) ?? fallback;
}

function buildCreateFromZeroQuestionResponse(requestId: string) {
  return {
    message: {
      id: `msg_dev_create_zero_question_${safeId(requestId)}`,
      role: "assistant",
      content:
        "我们可以从 0 开始做简历。我先确认目标岗位和基础资料，再逐步追问经历事实。",
    },
    toolCalls: [],
    proposedOperations: [],
    questions: [
      {
        id: "question_target_role",
        message: "你这次主要投递哪个岗位？",
        field: "goal.targetRole",
        responseSchema: {
          type: "object",
          properties: {
            answer: { type: "string", minLength: 1 },
          },
          required: ["answer"],
        },
      },
      {
        id: "question_basic_profile",
        message: "请补充你的姓名、当前身份、城市和 1-2 个核心优势。",
        field: "profile.basics",
        responseSchema: {
          type: "object",
          properties: {
            answer: { type: "string", minLength: 1 },
          },
          required: ["answer"],
        },
      },
    ],
  };
}

function buildQuestionResponse(requestId: string) {
  return {
    message: {
      id: `msg_dev_question_${safeId(requestId)}`,
      role: "assistant",
      content:
        "我会先确认目标岗位，再判断经历重点和措辞风险。你这次主要投递哪个岗位？",
    },
    toolCalls: [],
    proposedOperations: [],
    questions: [
      {
        id: "question_target_role",
        message: "你这次主要投递哪个岗位？",
        field: "goal.targetRole",
        responseSchema: {
          type: "object",
          properties: {
            answer: { type: "string", minLength: 1 },
          },
          required: ["answer"],
        },
      },
    ],
  };
}

function buildStagedChangeResponse({
  request,
  requestId,
  answer,
}: {
  request: AgentMessageRequest;
  requestId: string;
  answer: string;
}) {
  const section = firstEditableSection(request);
  const afterPlainText = [
    section.beforePlainText,
    `本地预览建议：围绕「${answer}」补充真实业务目标、行动和结果指标，再决定是否改写。`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message: {
      id: `msg_dev_change_${safeId(requestId)}`,
      role: "assistant",
      content:
        "收到补充信息。我先准备一条本地预览修改建议，便于你检查 Agent 对话、确认和预览应用流程。",
    },
    toolCalls: [
      {
        id: "tool_dev_update_experience",
        name: "resume_update_section",
        status: "completed",
        title: "准备本地预览修改",
        summary: "根据目标岗位生成一条待确认建议。",
        input: { fieldPath: section.fieldPath },
        result: { operationIds: ["op_dev_update_experience"] },
      },
    ],
    proposedOperations: [
      {
        id: "op_dev_update_experience",
        toolCallId: "tool_dev_update_experience",
        label: "应用本地预览改写",
        section: section.section,
        fieldPath: section.fieldPath,
        operation: "update_section",
        beforePlainText: section.beforePlainText,
        afterPlainText,
        replacementTiptapJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: afterPlainText }],
            },
          ],
        },
        changeSummary: "基于目标岗位补一条可确认的预览建议。",
        riskFlags: [
          {
            type: "needs_user_fact",
            message: "这是本地预览建议，请用真实指标替换示例提示。",
          },
        ],
      },
    ],
    questions: [],
  };
}

function buildReviewedChangeResponse({
  requestId,
  reviewDecision,
}: {
  requestId: string;
  reviewDecision: "approved" | "rejected";
}) {
  return {
    message: {
      id: `msg_dev_reviewed_${safeId(requestId)}`,
      role: "assistant",
      content:
        reviewDecision === "approved"
          ? "已应用这条本地预览修改。你可以继续让我检查下一处，或直接在预览里确认效果。"
          : "已忽略这条本地预览修改。我不会重复应用它，可以继续帮你换一个方向诊断。",
    },
    toolCalls: [],
    proposedOperations: [],
    questions: [],
  };
}

function firstEditableSection(request: AgentMessageRequest): {
  section: "summary" | "experience" | "projects" | "education" | "skills" | "research" | "custom";
  fieldPath: string;
  beforePlainText: string;
} {
  if (!request.context) {
    return {
      section: "summary",
      fieldPath: "basics.summary",
      beforePlainText:
        "请先补充真实经历事实，再由 Agent 帮你组织成可验证的简历表达。",
    };
  }

  const preferred =
    request.context.sections.find((section) =>
      section.fieldPath.startsWith("experience."),
    ) ?? request.context.sections[0];

  return {
    section: readOperationSection(preferred?.key),
    fieldPath: preferred?.fieldPath || "basics.summary",
    beforePlainText:
      preferred?.plainText.trim() ||
      "请在这里补充一段可验证的经历事实，再由 Agent 帮你组织表达。",
  };
}

function readOperationSection(
  value: string | undefined,
): "summary" | "experience" | "projects" | "education" | "skills" | "research" | "custom" {
  if (
    value === "summary" ||
    value === "experience" ||
    value === "projects" ||
    value === "education" ||
    value === "skills" ||
    value === "research" ||
    value === "custom"
  ) {
    return value;
  }
  return "summary";
}

function readLatestQuestionAnswers(request: AgentMessageRequest): Map<string, string> {
  const latest = [...request.messages]
    .reverse()
    .find((message) => message.content.includes("用户已补充 Agent 需要的信息"));
  const answers = new Map<string, string>();
  if (!latest) return answers;

  for (const match of latest.content.matchAll(/^([^：:\n]+)[：:]([^\n]+)/gm)) {
    const id = match[1]?.trim();
    const answer = match[2]?.trim();
    if (id && answer) answers.set(id, answer);
  }

  return answers;
}

function readLatestReviewDecision(
  request: AgentMessageRequest,
): "approved" | "rejected" | null {
  const latest = [...request.messages]
    .reverse()
    .find((message) => message.content.includes("用户已审核你的修改建议"));
  if (!latest) return null;
  if (latest.content.includes("✓ 已批准并应用")) return "approved";
  if (latest.content.includes("✗ 已拒绝")) return "rejected";
  return null;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
