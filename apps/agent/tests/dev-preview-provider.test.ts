import { describe, expect, it } from "vitest";

import type { AgentConfig } from "../src/config";
import type { AgentMessageRequest } from "../src/agent-messages";
import { createDevelopmentAgentMessageProvider } from "../src/workflows/dev-preview-provider";

describe("development Agent message preview provider", () => {
  it("is only available in development", () => {
    expect(createDevelopmentAgentMessageProvider(config("development"))).toBeDefined();
    expect(createDevelopmentAgentMessageProvider(config("production"))).toBeUndefined();
    expect(createDevelopmentAgentMessageProvider(config("test"))).toBeUndefined();
  });

  it("asks a typed question on the first local preview run", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: request(),
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        resumeId: "resume_abc",
        jti: "jti_dev_preview",
      },
      requestId: "req_dev_preview",
    });
    const body = JSON.parse(result.content);

    expect(result.usage).toEqual({
      provider: "intro-dev-preview",
      model: "agent-v2-preview",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(body).toMatchObject({
      message: {
        role: "assistant",
        content: expect.stringContaining("目标岗位"),
      },
      toolCalls: [],
      proposedOperations: [],
      questions: [
        expect.objectContaining({
          id: "question_target_role",
          field: "goal.targetRole",
        }),
      ],
    });
  });

  it("asks for target role and basic profile facts on the first create-from-zero run", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: {
        resumeId: null,
        mode: "create_from_zero",
        locale: "zh-CN",
        workflowId: "create-from-zero",
        messages: [
          {
            id: "msg_user_create",
            role: "user",
            content: "从 0 帮我做一份前端工程师简历",
          },
        ],
        context: null,
      },
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        jti: "jti_dev_preview_create_zero",
      },
      requestId: "req_dev_preview_create_zero",
    });
    const body = JSON.parse(result.content);

    expect(body).toMatchObject({
      message: {
        role: "assistant",
        content: expect.stringContaining("从 0"),
      },
      toolCalls: [],
      proposedOperations: [],
      questions: [
        expect.objectContaining({
          id: "question_target_role",
          field: "goal.targetRole",
        }),
        expect.objectContaining({
          id: "question_basic_profile",
          field: "profile.basics",
        }),
      ],
    });
  });

  it("stages a safe resume operation after the user answers a question", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: request({
        messages: [
          {
            id: "msg_user_1",
            role: "user",
            content: "请诊断这份简历",
          },
          {
            id: "system_interrupt_1",
            role: "assistant",
            content:
              "用户已补充 Agent 需要的信息：\nquestion_target_role：增长型前端工程师\n请基于用户补充的信息继续当前任务。",
          },
        ],
      }),
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        resumeId: "resume_abc",
        jti: "jti_dev_preview_resume",
      },
      requestId: "req_dev_preview_resume",
    });
    const body = JSON.parse(result.content);

    expect(body.toolCalls).toEqual([
      expect.objectContaining({
        id: "tool_dev_update_experience",
        name: "resume_update_section",
      }),
    ]);
    expect(body.proposedOperations).toEqual([
      expect.objectContaining({
        id: "op_dev_update_experience",
        toolCallId: "tool_dev_update_experience",
        fieldPath: "experience.0.content",
        operation: "update_section",
        afterPlainText: expect.stringContaining("增长型前端工程师"),
      }),
    ]);
    expect(body.questions ?? []).toEqual([]);
  });

  it("creates a draft resume workspace after create-from-zero answers", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: {
        resumeId: null,
        mode: "create_from_zero",
        locale: "zh-CN",
        workflowId: "create-from-zero",
        messages: [
          {
            id: "msg_user_create",
            role: "user",
            content: "从 0 帮我做一份简历",
          },
          {
            id: "system_interrupt_answers",
            role: "assistant",
            content:
              "用户已补充 Agent 需要的信息：\nquestion_target_role：增长型前端工程师\nquestion_basic_profile：张三，应届生，上海，React 工程化\n请基于用户补充的信息继续当前任务。",
          },
        ],
        context: null,
      },
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        jti: "jti_dev_preview_create_zero_answers",
      },
      requestId: "req_dev_preview_create_zero_answers",
    });
    const body = JSON.parse(result.content);

    expect(body.message.content).toContain("简历草稿");
    expect(body.toolCalls).toEqual([]);
    expect(body.proposedOperations).toEqual([]);
    expect(body.questions).toEqual([
      expect.objectContaining({
        id: "question_recent_experience",
        field: "experience.primary",
        message: expect.stringContaining("最近一段经历"),
      }),
      expect.objectContaining({
        id: "question_project_example",
        field: "projects.primary",
        message: expect.stringContaining("项目"),
      }),
      expect.objectContaining({
        id: "question_education",
        field: "education.primary",
        message: expect.stringContaining("教育背景"),
      }),
    ]);
    expect(body.draftResume).toMatchObject({
      title: "增长型前端工程师简历草稿",
      targetRole: "增长型前端工程师",
      profileSummary: "张三，应届生，上海，React 工程化",
      missingFacts: expect.arrayContaining(["工作经历", "项目经历", "教育背景"]),
    });
    expect(JSON.stringify(body.draftResume)).not.toContain("负责业务系统前端开发");
  });

  it("merges create-from-zero fact answers into the existing draft workspace", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: createFromZeroFactRequest(),
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        jti: "jti_dev_preview_create_zero_facts",
      },
      requestId: "req_dev_preview_create_zero_facts",
    });
    const body = JSON.parse(result.content);

    expect(body.message.content).toContain("合并进简历草稿");
    expect(body.toolCalls).toEqual([]);
    expect(body.proposedOperations).toEqual([]);
    expect(body.draftResume.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "experience",
          summary: expect.stringContaining("增长实验"),
          status: "drafted",
        }),
        expect.objectContaining({
          key: "projects",
          summary: expect.stringContaining("智能简历"),
          status: "drafted",
        }),
        expect.objectContaining({
          key: "education",
          summary: expect.stringContaining("上海大学"),
          status: "drafted",
        }),
      ]),
    );
    expect(body.draftResume.missingFacts).not.toEqual(
      expect.arrayContaining(["工作经历", "项目经历", "教育背景"]),
    );
    expect(body.questions).toEqual([
      expect.objectContaining({
        id: "question_skills_highlights",
        field: "skills.primary",
        message: expect.stringContaining("技能"),
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("你这次主要投递哪个岗位");
  });

  it("keeps create-from-zero fact merging valid for legacy drafts without a profile summary", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");
    const request = createFromZeroFactRequest();
    if (request.sessionSnapshot?.workspace.draftResume) {
      request.sessionSnapshot.workspace.draftResume.profileSummary = "";
    }

    const result = await provider.run({
      request,
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        jti: "jti_dev_preview_create_zero_legacy_facts",
      },
      requestId: "req_dev_preview_create_zero_legacy_facts",
    });
    const body = JSON.parse(result.content);

    expect(body.message.content).toContain("合并进简历草稿");
    expect(body.draftResume.profileSummary).toBe("基础资料待补充");
  });

  it("merges create-from-zero skill highlights into the draft and asks for final review", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: createFromZeroSkillRequest(),
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        jti: "jti_dev_preview_create_zero_skills",
      },
      requestId: "req_dev_preview_create_zero_skills",
    });
    const body = JSON.parse(result.content);

    expect(body.message.content).toContain("技能亮点");
    expect(body.toolCalls).toEqual([]);
    expect(body.proposedOperations).toEqual([]);
    expect(body.draftResume.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "skills",
          label: "技能亮点",
          summary: expect.stringContaining("React"),
          status: "drafted",
        }),
      ]),
    );
    expect(body.draftResume.missingFacts).not.toEqual(
      expect.arrayContaining(["工作经历", "项目经历", "教育背景", "技能亮点"]),
    );
    expect(body.questions).toEqual([
      expect.objectContaining({
        id: "question_draft_review",
        field: "draft.review",
        message: expect.stringContaining("确认"),
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("你这次主要投递哪个岗位");
    expect(JSON.stringify(body)).not.toContain("resume_update_section");
  });

  it("summarizes the create-from-zero draft after final review answers", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: createFromZeroFinalReviewRequest(),
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        jti: "jti_dev_preview_create_zero_final_review",
      },
      requestId: "req_dev_preview_create_zero_final_review",
    });
    const body = JSON.parse(result.content);

    expect(body.message.content).toContain("草稿方向已确认");
    expect(body.message.content).toContain("业务增长");
    expect(body.toolCalls).toEqual([]);
    expect(body.proposedOperations).toEqual([]);
    expect(body.questions ?? []).toEqual([]);
    expect(body.draftResume.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "skills",
          label: "技能亮点",
          status: "drafted",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("resume_update_section");
    expect(JSON.stringify(body)).not.toContain("create_from_zero");
  });

  it("finishes the local preview loop after the user approves a staged change", async () => {
    const provider = createDevelopmentAgentMessageProvider(config("development"));
    if (!provider) throw new Error("expected development provider");

    const result = await provider.run({
      request: request({
        messages: [
          {
            id: "msg_user_1",
            role: "user",
            content: "请诊断这份简历",
          },
          {
            id: "system_interrupt_approval",
            role: "assistant",
            content:
              "用户已审核你的修改建议：\n✓ 已批准并应用：op_dev_update_experience\n请基于用户的选择继续对话。",
          },
        ],
      }),
      prompt: { system: "", developer: "", user: "" },
      session: {
        userId: "user_123",
        scope: "agent:chat",
        resumeId: "resume_abc",
        jti: "jti_dev_preview_approval",
      },
      requestId: "req_dev_preview_approval",
    });
    const body = JSON.parse(result.content);

    expect(body.message.content).toContain("已应用");
    expect(body.toolCalls).toEqual([]);
    expect(body.proposedOperations).toEqual([]);
    expect(body.questions ?? []).toEqual([]);
  });
});

function config(nodeEnv: string): AgentConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    serviceName: "intro-agent",
    version: "test",
    nodeEnv,
    shutdownTimeoutMs: 100,
    redisUrl: "redis://127.0.0.1:6379",
    redisConnectTimeoutMs: 100,
    rateLimitWindowSeconds: 60,
    rateLimitMaxRequests: 30,
    jwtIssuer: "intro-builder-web",
    jwtAudience: "intro-builder-agent",
    jwtSecret: "test-agent-secret",
    jwtReplayTtlSeconds: 180,
    modelBaseUrl: undefined,
    modelApiKey: undefined,
    modelName: undefined,
    modelTimeoutMs: 20_000,
    langfuse: {
      enabled: false,
      publicKey: undefined,
      secretKey: undefined,
      baseUrl: "https://cloud.langfuse.com",
      environment: nodeEnv,
      release: "test",
      timeoutSeconds: 5,
      sampleRate: 1,
      captureRawPayloads: false,
    },
  };
}

function request(
  overrides: Partial<AgentMessageRequest> = {},
): AgentMessageRequest {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    workflowId: "resume-diagnose",
    messages: [
      {
        id: "msg_user_1",
        role: "user",
        content: "请诊断这份简历",
      },
    ],
    context: {
      resumeTitle: "前端开发工程师",
      templateId: "professional",
      activeSection: "experience",
      completeness: {
        overall: 72,
        sections: [
          { key: "experience", label: "工作经历", score: 6, max: 10 },
        ],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          fieldPath: "experience.0.content",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    ...overrides,
  };
}

function createFromZeroFactRequest(): AgentMessageRequest {
  return {
    resumeId: null,
    mode: "create_from_zero",
    locale: "zh-CN",
    workflowId: "create-from-zero",
    messages: [
      {
        id: "msg_user_create",
        role: "user",
        content: "从 0 帮我做一份简历",
      },
      {
        id: "system_interrupt_fact_answers",
        role: "assistant",
        content:
          "用户已补充 Agent 需要的信息：\nquestion_recent_experience：在 A 公司做增长实验，负责落地报名转化页面，转化率提升 18%。\nquestion_project_example：智能简历项目，负责编辑器和实时预览，减少导出返工。\nquestion_education：上海大学，软件工程，本科，2022-2026。\n请基于用户补充的信息继续当前任务。",
      },
    ],
    sessionSnapshot: createZeroSessionSnapshot(),
    context: null,
  };
}

function createFromZeroSkillRequest(): AgentMessageRequest {
  const sessionSnapshot = createZeroSessionSnapshot();
  sessionSnapshot.workspace.draftResume = {
    title: "增长型前端工程师简历草稿",
    targetRole: "增长型前端工程师",
    profileSummary: "张三，应届生，上海，React 工程化",
    sections: [
      {
        key: "basics",
        label: "基础信息",
        summary: "张三，应届生，上海，React 工程化",
        status: "drafted",
      },
      {
        key: "experience",
        label: "工作经历",
        summary: "在 A 公司做增长实验，负责落地报名转化页面，转化率提升 18%。",
        status: "drafted",
      },
      {
        key: "projects",
        label: "项目经历",
        summary: "智能简历项目，负责编辑器和实时预览，减少导出返工。",
        status: "drafted",
      },
      {
        key: "education",
        label: "教育背景",
        summary: "上海大学，软件工程，本科，2022-2026。",
        status: "drafted",
      },
      {
        key: "skills",
        label: "技能亮点",
        summary: "等待补充技能关键词和突出能力。",
        status: "needs_user_fact",
      },
    ],
    missingFacts: ["技能亮点"],
  };
  sessionSnapshot.workspace.goal.resumeTitle = "增长型前端工程师简历草稿";
  sessionSnapshot.workspace.goal.targetRole = "增长型前端工程师";

  return {
    resumeId: null,
    mode: "create_from_zero",
    locale: "zh-CN",
    workflowId: "create-from-zero",
    messages: [
      {
        id: "msg_user_create",
        role: "user",
        content: "从 0 帮我做一份简历",
      },
      {
        id: "system_interrupt_skill_answers",
        role: "assistant",
        content:
          "用户已补充 Agent 需要的信息：\nquestion_skills_highlights：React, TypeScript, 数据看板, 跨团队协作\n请基于用户补充的信息继续当前任务。",
      },
    ],
    sessionSnapshot,
    context: null,
  };
}

function createFromZeroFinalReviewRequest(): AgentMessageRequest {
  const request = createFromZeroSkillRequest();
  if (request.sessionSnapshot?.workspace.draftResume) {
    request.sessionSnapshot.workspace.draftResume.sections = [
      ...request.sessionSnapshot.workspace.draftResume.sections.filter(
        (section) => section.key !== "skills",
      ),
      {
        key: "skills",
        label: "技能亮点",
        summary: "React, TypeScript, 数据看板, 跨团队协作",
        status: "drafted",
      },
    ];
    request.sessionSnapshot.workspace.draftResume.missingFacts = [];
  }
  return {
    ...request,
    messages: [
      {
        id: "msg_user_create",
        role: "user",
        content: "从 0 帮我做一份简历",
      },
      {
        id: "system_interrupt_final_review",
        role: "assistant",
        content:
          "用户已补充 Agent 需要的信息：\nquestion_draft_review：整体偏业务增长，突出数据看板和跨团队推动，语气务实直接。\n请基于用户补充的信息继续当前任务。",
      },
    ],
  };
}

function createZeroSessionSnapshot() {
  const draftResume = {
    title: "增长型前端工程师简历草稿",
    targetRole: "增长型前端工程师",
    profileSummary: "张三，应届生，上海，React 工程化",
    sections: [
      {
        key: "basics",
        label: "基础信息",
        summary: "张三，应届生，上海，React 工程化",
        status: "drafted" as const,
      },
      {
        key: "experience",
        label: "工作经历",
        summary: "等待补充真实经历事实、业务目标、行动和结果。",
        status: "needs_user_fact" as const,
      },
      {
        key: "projects",
        label: "项目经历",
        summary: "等待补充项目背景、职责、技术栈和可验证结果。",
        status: "needs_user_fact" as const,
      },
      {
        key: "education",
        label: "教育背景",
        summary: "等待补充学校、专业、学历和时间信息。",
        status: "needs_user_fact" as const,
      },
    ],
    missingFacts: ["工作经历", "项目经历", "教育背景"],
  };

  return {
    sessionId: "agent_session_create_from_zero",
    threadId: "agent_create_from_zero",
    resumeId: null,
    userIdHash: "sha256:user",
    mode: "create_from_zero" as const,
    status: "waiting_user" as const,
    workflow: {
      workflowId: "create-from-zero" as const,
      nodeId: "await_user_input",
      loopCount: 2,
      completedNodeIds: ["intake_goal"],
    },
    workspace: {
      resumeId: null,
      mode: "create_from_zero" as const,
      goal: {
        workflowId: "create-from-zero",
        resumeTitle: "增长型前端工程师简历草稿",
        targetRole: "增长型前端工程师",
        locale: "zh-CN" as const,
      },
      facts: [],
      draftResume,
      changeSets: [],
      decisions: [],
      qualityReport: null,
      updatedAt: "2026-06-13T00:00:00.000Z",
    },
    contextStatus: null,
    pendingInterrupts: [],
    lastResumeContentHash: null,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  };
}
