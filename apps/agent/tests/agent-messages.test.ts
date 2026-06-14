import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  buildAgentMessagePrompt,
  extractStreamingAgentMessageContent,
  parseAgentMessageProviderResponse,
  toAgUiAgentEvents,
  validateAgentMessageRequest,
} from "../src/agent-messages";

describe("agent messages", () => {
  it("validates an Agent message request", () => {
    const result = validateAgentMessageRequest(validBody());

    expect(result).toMatchObject({
      ok: true,
      request: {
        resumeId: "resume_abc",
        locale: "zh-CN",
        workflowId: "resume-diagnose",
        messages: [{ role: "user", content: "诊断整份简历" }],
        context: {
          resumeTitle: "前端开发工程师",
          templateId: "professional",
          sections: [
            {
              fieldPath: "experience.0.content",
              plainText: "负责业务系统前端开发，优化页面性能。",
            },
          ],
        },
      },
    });
  });

  it("accepts a durable Agent session snapshot on message requests", () => {
    const result = validateAgentMessageRequest(
      validBody({ sessionSnapshot: agentSessionSnapshot() }),
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        sessionSnapshot: expect.objectContaining({
          sessionId: "agent_session_resume_abc",
          status: "waiting_user",
        }),
      },
    });
  });

  it("accepts create-from-zero requests without an existing resume snapshot", () => {
    const result = validateAgentMessageRequest({
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
    });

    expect(result).toEqual({
      ok: true,
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
    });
  });

  it("keeps optimize-existing requests strict about resume snapshots", () => {
    const result = validateAgentMessageRequest({
      ...validBody(),
      mode: "optimize_existing",
      context: null,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      error: "bad_request",
      message: "context is required",
    });
  });

  it("rejects unsafe request-scoped model base URLs", () => {
    for (const baseUrl of [
      "http://127.0.0.1:11434/v1",
      "http://169.254.169.254/latest",
      "https://169.254.169.254/latest",
      "https://[::ffff:169.254.169.254]/latest",
      "https://[::ffff:7f00:1]/v1",
      "https://2130706433/v1",
      "https://0x7f000001/v1",
      "https://017700000001/v1",
      "file:///tmp/model",
      "not a url",
    ]) {
      const result = validateAgentMessageRequest(
        validBody({
          modelConfig: {
            baseUrl,
            apiKey: "sk-test-local",
            modelName: "gpt-5-mini",
          },
        }),
      );

      expect(result).toEqual({
        ok: false,
        statusCode: 400,
        error: "bad_request",
        message: "modelConfig.baseUrl is not allowed",
      });
    }
  });

  it("rejects malformed durable Agent session snapshots", () => {
    const result = validateAgentMessageRequest(
      validBody({
        sessionSnapshot: {
          sessionId: "agent_session_resume_abc",
          contextStatus: { effectiveInputBudgetTokens: 42 },
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      error: "bad_request",
      message: "sessionSnapshot is invalid",
    });
  });

  it("rejects contexts that exceed the plain text limit", () => {
    const result = validateAgentMessageRequest(
      validBody({
        context: {
          ...validBody().context,
          sections: [
            {
              key: "experience",
              label: "工作经历 1",
              fieldPath: "experience.0.content",
              plainText: "x".repeat(12_001),
            },
          ],
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: "context plain text must be at most 12000 characters",
    });
  });

  it("builds a prompt that exposes AG-UI-aligned minimal tool names and STAR safety rules", () => {
    const result = validateAgentMessageRequest(validBody());
    if (!result.ok) throw new Error("expected valid request");

    const prompt = buildAgentMessagePrompt({
      ...result.request,
      requestId: "req_agent",
    });

    expect(prompt.system).toContain("intro-builder 的简历 Agent");
    expect(prompt.developer).toContain(
      "可用 tools: resume_read, resume_update_section, resume_delete_section, resume_reorder_sections, resume_insert_section",
    );
    expect(prompt.developer).toContain("所有简历修改必须作为 proposedOperations 返回");
    expect(prompt.developer).toContain("使用 STAR 原则时，不得编造 Result 指标");
    expect(prompt.developer).toContain("toolCalls: [] 和 proposedOperations: []");
    expect(prompt.developer).toContain("questions");
    expect(prompt.user).toContain("workflowId: resume-diagnose");
    expect(prompt.user).toContain("experience.0.content");
  });

  it("builds a create-from-zero prompt without reading resume context sections", () => {
    const result = validateAgentMessageRequest({
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
    });
    if (!result.ok) throw new Error("expected valid create-from-zero request");

    const prompt = buildAgentMessagePrompt({
      ...result.request,
      requestId: "req_agent_create",
    });

    expect(prompt.user).toContain("workflowId: create-from-zero");
    expect(prompt.user).toContain("当前还没有可读取的简历快照");
    expect(prompt.user).not.toContain("undefined");
    expect(prompt.user).not.toContain("sections:");
  });

  it("parses provider response with tool calls and proposed operations", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化工作经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_read",
            status: "completed",
            title: "检查简历",
            summary: "发现工作经历缺少结果。",
            input: { scope: "resume" },
            result: { topIssue: "缺少结果" },
          },
        ],
        proposedOperations: [],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化工作经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_read",
            status: "completed",
            title: "检查简历",
            summary: "发现工作经历缺少结果。",
            input: { scope: "resume" },
            result: { topIssue: "缺少结果" },
          },
        ],
        proposedOperations: [],
      },
    });
  });

  it("parses conversational provider responses that omit empty tool arrays", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_followup",
          role: "assistant",
          content: "请确认你想优化第 3 段项目经历吗？",
        },
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        message: {
          id: "msg_assistant_followup",
          role: "assistant",
          content: "请确认你想优化第 3 段项目经历吗？",
        },
        toolCalls: [],
        proposedOperations: [],
      },
    });
  });

  it("parses provider questions for human-in-the-loop follow-up", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_question",
          role: "assistant",
          content: "我需要确认目标岗位后再继续。",
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
              properties: { answer: { type: "string", minLength: 1 } },
              required: ["answer"],
            },
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: expect.objectContaining({
        questions: [
          {
            id: "question_target_role",
            message: "你这次主要投递哪个岗位？",
            field: "goal.targetRole",
            responseSchema: {
              type: "object",
              properties: { answer: { type: "string", minLength: 1 } },
              required: ["answer"],
            },
          },
        ],
      }),
    });
  });

  it("normalizes provider operations that omit transport toolCallId linkage", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_tool_fix",
          role: "assistant",
          content: "我生成了 1 条待确认修改。",
        },
        toolCalls: [],
        proposedOperations: [
          {
            id: "op_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "Token 调用优化降低 200%。",
            afterPlainText: "Token 调用优化提升 200% 效率。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "修正指标表述，保留用户确认写回。",
            riskFlags: [],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        message: {
          id: "msg_assistant_tool_fix",
          role: "assistant",
          content: "我生成了 1 条待确认修改。",
        },
        toolCalls: [
          expect.objectContaining({
            id: "tool_op_1",
            name: "resume_update_section",
            status: "completed",
          }),
        ],
        proposedOperations: [
          expect.objectContaining({
            id: "op_1",
            toolCallId: "tool_op_1",
            operation: "update_section",
          }),
        ],
      },
    });
  });

  it("converts parsed provider output into chunked AG-UI text events", () => {
    const assistantContent =
      "建议先优化第一段工作经历。我会按 STAR 拆成情境、任务、行动与结果，并标记需要你补充的真实指标。";
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: assistantContent,
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历。",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化；结果指标需要补充。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [{ type: "needs_user_fact", message: "请补充结果指标。" }],
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      result: parsed.result,
    });

    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events[1]?.type).toBe(EventType.TEXT_MESSAGE_START);
    expect(events.at(-2)?.type).toBe(EventType.TEXT_MESSAGE_END);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const textDeltas = events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta);
    expect(textDeltas.length).toBeGreaterThan(1);
    expect(textDeltas.join("")).toBe(assistantContent);
    expect(events).toContainEqual(expect.objectContaining({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "tool_1",
      content: expect.stringContaining('"proposedOperations"'),
    }));
  });

  it("emits v2 context status state and activity before assistant text", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_context",
          role: "assistant",
          content: "我会先读取当前简历。",
        },
        toolCalls: [],
        proposedOperations: [],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      request: validBody(),
      result: parsed.result,
    });

    const stateDeltaIndex = events.findIndex(
      (event) => event.type === EventType.STATE_DELTA,
    );
    const activityIndex = events.findIndex(
      (event) =>
        event.type === EventType.ACTIVITY_SNAPSHOT &&
        event.activityType === "context_status",
    );
    const textStartIndex = events.findIndex(
      (event) => event.type === EventType.TEXT_MESSAGE_START,
    );

    expect(stateDeltaIndex).toBeGreaterThan(0);
    expect(activityIndex).toBeGreaterThan(0);
    expect(stateDeltaIndex).toBeLessThan(textStartIndex);
    expect(activityIndex).toBeLessThan(textStartIndex);
    expect(events[stateDeltaIndex]).toEqual(
      expect.objectContaining({
        type: EventType.STATE_DELTA,
        delta: [
          expect.objectContaining({
            op: "replace",
            path: "/contextStatus",
            value: expect.objectContaining({
              effectiveInputBudgetTokens: 200_000,
              status: "healthy",
            }),
          }),
        ],
      }),
    );
    expect(events[activityIndex]).toEqual(
      expect.objectContaining({
        type: EventType.ACTIVITY_SNAPSHOT,
        activityType: "context_status",
        content: expect.objectContaining({
          effectiveInputBudgetTokens: 200_000,
          status: "healthy",
        }),
      }),
    );
  });

  it("emits v2 resume workspace state with staged change sets before run finish", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_workspace",
          role: "assistant",
          content: "我生成了一组待确认修改。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历。",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [],
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      request: validBody(),
      result: parsed.result,
    });

    const toolResultIndex = events.findIndex(
      (event) => event.type === EventType.TOOL_CALL_RESULT,
    );
    const workspaceStateIndex = events.findIndex(
      (event) =>
        event.type === EventType.STATE_DELTA &&
        event.delta.some((patch) => patch.path === "/workspace"),
    );
    const workspaceActivityIndex = events.findIndex(
      (event) =>
        event.type === EventType.ACTIVITY_SNAPSHOT &&
        event.activityType === "resume_workspace",
    );
    const runFinishedIndex = events.findIndex(
      (event) => event.type === EventType.RUN_FINISHED,
    );

    expect(toolResultIndex).toBeGreaterThan(0);
    expect(workspaceStateIndex).toBeGreaterThan(toolResultIndex);
    expect(workspaceActivityIndex).toBeGreaterThan(toolResultIndex);
    expect(workspaceStateIndex).toBeLessThan(runFinishedIndex);
    expect(workspaceActivityIndex).toBeLessThan(runFinishedIndex);
    expect(events[workspaceStateIndex]).toEqual(
      expect.objectContaining({
        type: EventType.STATE_DELTA,
        delta: [
          expect.objectContaining({
            op: "replace",
            path: "/workspace",
            value: expect.objectContaining({
              mode: "optimize_existing",
              resumeId: "resume_abc",
              goal: expect.objectContaining({
                workflowId: "resume-diagnose",
                resumeTitle: "前端开发工程师",
              }),
              changeSets: [
                expect.objectContaining({
                  id: "changeset_req_agent",
                  status: "staged",
                  operationIds: ["op_1"],
                  operations: [expect.objectContaining({ id: "op_1" })],
                }),
              ],
            }),
          }),
        ],
      }),
    );
    expect(events[workspaceActivityIndex]).toEqual(
      expect.objectContaining({
        type: EventType.ACTIVITY_SNAPSHOT,
        activityType: "resume_workspace",
        content: expect.objectContaining({
          changeSets: [
            expect.objectContaining({
              id: "changeset_req_agent",
              operationIds: ["op_1"],
            }),
          ],
        }),
      }),
    );
  });

  it("emits durable workflow cursor state before run finish", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_workflow",
          role: "assistant",
          content: "我需要先确认目标岗位。",
        },
        toolCalls: [],
        proposedOperations: [],
        questions: [
          {
            id: "question_target_role",
            message: "你这次主要投递哪个岗位？",
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      request: validBody({ sessionSnapshot: agentSessionSnapshot() }),
      result: parsed.result,
    });

    const workflowStateIndex = events.findIndex(
      (event) =>
        event.type === EventType.STATE_DELTA &&
        event.delta.some((patch) => patch.path === "/workflow"),
    );
    const runFinishedIndex = events.findIndex(
      (event) => event.type === EventType.RUN_FINISHED,
    );

    expect(workflowStateIndex).toBeGreaterThan(0);
    expect(workflowStateIndex).toBeLessThan(runFinishedIndex);
    expect(events[workflowStateIndex]).toEqual(
      expect.objectContaining({
        type: EventType.STATE_DELTA,
        delta: [
          expect.objectContaining({
            op: "replace",
            path: "/workflow",
            value: {
              workflowId: "resume-diagnose",
              nodeId: "await_user_input",
              loopCount: 2,
              completedNodeIds: ["intake_goal"],
            },
          }),
        ],
      }),
    );
  });

  it("extracts partial assistant content from streaming provider JSON", () => {
    const partialJson =
      '{"message":{"id":"msg_assistant_1","role":"assistant","content":"先优化第一段经历\\n补充真实结果';

    expect(extractStreamingAgentMessageContent(partialJson)).toBe(
      "先优化第一段经历\n补充真实结果",
    );
    expect(extractStreamingAgentMessageContent('{"message":{"content":"')).toBe("");
    expect(extractStreamingAgentMessageContent('{"toolCalls":[{"input":{"content":"不要吐工具参数"}}]}')).toBe("");
  });

  it("outputs RUN_FINISHED with interrupt when proposedOperations are present", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "我建议优化这段经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [],
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      result: parsed.result,
    });

    const runFinished = events.find((event) => event.type === EventType.RUN_FINISHED);
    expect(runFinished).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "op_1",
            reason: "approval_required",
            message: "应用经历改写: 补足任务与行动。",
            toolCallId: "tool_1",
            metadata: { operation: parsed.result.proposedOperations[0] },
          },
        ],
      },
    });
  });

  it("outputs RUN_FINISHED with success when no proposedOperations", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "你的简历已经很好了。",
        },
        toolCalls: [],
        proposedOperations: [],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      result: parsed.result,
    });

    const runFinished = events.find((event) => event.type === EventType.RUN_FINISHED);
    expect(runFinished).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: { type: "success" },
    });
  });
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN" as const,
    workflowId: "resume-diagnose" as const,
    messages: [{ id: "msg_user_1", role: "user" as const, content: "诊断整份简历" }],
    context: {
      resumeTitle: "前端开发工程师",
      templateId: "professional",
      activeSection: null,
      completeness: {
        overall: 80,
        sections: [{ key: "experience", label: "工作经历", score: 18, max: 25 }],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历 1",
          fieldPath: "experience.0.content",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    ...overrides,
  };
}

function agentSessionSnapshot() {
  return {
    sessionId: "agent_session_resume_abc",
    threadId: "resume_abc",
    resumeId: "resume_abc",
    userIdHash: "sha256:user",
    mode: "optimize_existing",
    status: "waiting_user",
    workflow: {
      workflowId: "resume-diagnose",
      nodeId: "intake_goal",
      loopCount: 1,
      completedNodeIds: [],
    },
    workspace: {
      resumeId: "resume_abc",
      mode: "optimize_existing",
      goal: {
        workflowId: "resume-diagnose",
        resumeTitle: "前端工程师",
        targetRole: "增长型前端工程师",
        locale: "zh-CN",
      },
      facts: [],
      draftResume: null,
      changeSets: [],
      decisions: [],
      qualityReport: null,
      updatedAt: "2026-06-12T08:45:00.000Z",
    },
    contextStatus: {
      effectiveInputBudgetTokens: 200_000,
      modelInputLimitTokens: 214_000,
      reservedOutputTokens: 8_000,
      reservedSystemTokens: 6_000,
      usedInputTokens: 48_000,
      utilization: 0.24,
      status: "healthy",
      policy: "full_context",
      sources: [],
      lastCompactionAt: null,
      warnings: [],
    },
    pendingInterrupts: [
      {
        id: "question_target_role",
        reason: "input_required",
        message: "你这次主要投递哪个岗位？",
        toolCallId: null,
        metadata: { kind: "question" },
      },
    ],
    lastResumeContentHash: null,
    createdAt: "2026-06-12T08:30:00.000Z",
    updatedAt: "2026-06-12T08:45:00.000Z",
  };
}

function agentConfig() {
  return {
    host: "127.0.0.1",
    port: 0,
    serviceName: "intro-agent-test",
    version: "test-version",
    nodeEnv: "test",
    shutdownTimeoutMs: 100,
    redisUrl: "redis://127.0.0.1:6379",
    redisConnectTimeoutMs: 100,
    rateLimitWindowSeconds: 60,
    rateLimitMaxRequests: 30,
    jwtIssuer: "intro-builder-web",
    jwtAudience: "intro-builder-agent",
    jwtSecret: "test-agent-secret",
    jwtReplayTtlSeconds: 180,
    modelBaseUrl: "https://provider.test/v1",
    modelApiKey: "provider-key",
    modelName: "deepseek-chat",
    modelTimeoutMs: 20_000,
    langfuse: {
      enabled: false,
      publicKey: undefined,
      secretKey: undefined,
      baseUrl: "https://cloud.langfuse.com",
      environment: "test",
      release: "test-version",
      timeoutSeconds: 5,
      sampleRate: 1,
      captureRawPayloads: false,
    },
  };
}
