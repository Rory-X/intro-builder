import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import type {
  AgentMessageRequest,
  AgentMessageParseResult,
} from "../src/agent-messages";
import { buildWorkflowRuntimeEvents } from "../src/workflows/workflow-runtime";

describe("workflow runtime", () => {
  it("builds ordered runtime events without leaking AG-UI event names", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request: validRequest(),
      result: parsedResult({
        proposedOperations: [resumeOperation()],
      }),
    });

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "state_snapshot",
      "context_status",
      "assistant_text_delta",
      "tool_started",
      "tool_result",
      "workspace_snapshot",
      "workflow_cursor",
      "message_end",
      "run_finished",
    ]);
    expect(events.map((event) => event.type)).not.toContain(EventType.RUN_STARTED);
    expect(events.map((event) => event.type)).not.toContain(EventType.STATE_DELTA);
    expect(events.map((event) => event.type)).not.toContain(
      EventType.ACTIVITY_SNAPSHOT,
    );
  });

  it("records approval interrupts when staged operations exist", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request: validRequest(),
      result: parsedResult({
        proposedOperations: [resumeOperation()],
      }),
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "run_finished",
        outcome: {
          type: "interrupt",
          interrupts: [
            expect.objectContaining({
              id: "op_1",
              reason: "approval_required",
              toolCallId: "tool_1",
            }),
          ],
        },
      }),
    );
  });

  it("records question interrupts when the runtime needs user input", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request: validRequest(),
      result: {
        ...parsedResult({ proposedOperations: [] }),
        questions: [
          {
            id: "question_target_role",
            message: "你这次主要投递哪个岗位？",
            field: "goal.targetRole",
          },
        ],
      },
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "run_finished",
        outcome: {
          type: "interrupt",
          interrupts: [
            expect.objectContaining({
              id: "question_target_role",
              reason: "input_required",
              message: "你这次主要投递哪个岗位？",
              responseSchema: expect.objectContaining({ type: "object" }),
              metadata: {
                kind: "question",
                field: "goal.targetRole",
              },
            }),
          ],
        },
      }),
    );
  });

  it("starts from an existing durable session snapshot when one is provided", () => {
    const request = {
      ...validRequest(),
      sessionSnapshot: agentSessionSnapshot(),
    };
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request,
      result: parsedResult({ proposedOperations: [] }),
    });

    expect(events[1]).toEqual({
      type: "state_snapshot",
      snapshot: {
        contextStatus: agentSessionSnapshot().contextStatus,
        workspace: agentSessionSnapshot().workspace,
        workflow: agentSessionSnapshot().workflow,
      },
    });
  });

  it("starts new sessions with a workflow state path before workflow deltas", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request: validRequest(),
      result: parsedResult({ proposedOperations: [] }),
    });

    expect(events[1]).toEqual({
      type: "state_snapshot",
      snapshot: {
        contextStatus: null,
        workspace: null,
        workflow: {
          workflowId: "resume-diagnose",
          nodeId: "intake_goal",
          loopCount: 0,
          completedNodeIds: [],
        },
      },
    });
  });

  it("advances the durable workflow cursor when the run asks a question", () => {
    const request = {
      ...validRequest(),
      sessionSnapshot: agentSessionSnapshot(),
    };
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request,
      result: {
        ...parsedResult({ proposedOperations: [] }),
        questions: [
          {
            id: "question_target_role",
            message: "你这次主要投递哪个岗位？",
          },
        ],
      },
    });

    expect(events).toContainEqual({
      type: "workflow_cursor",
      cursor: {
        workflowId: "resume-diagnose",
        nodeId: "await_user_input",
        loopCount: 2,
        completedNodeIds: ["intake_goal"],
      },
    });
  });

  it("advances the durable workflow cursor while waiting for change approval", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request: validRequest(),
      result: parsedResult({
        proposedOperations: [resumeOperation()],
      }),
    });

    expect(events).toContainEqual({
      type: "workflow_cursor",
      cursor: {
        workflowId: "resume-diagnose",
        nodeId: "await_change_approval",
        loopCount: 1,
        completedNodeIds: ["intake_goal"],
      },
    });
  });

  it("finishes successfully when there are no staged operations", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_runtime",
      threadId: "resume_abc",
      request: validRequest(),
      result: parsedResult({ proposedOperations: [] }),
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "run_finished",
        outcome: { type: "success" },
      }),
    );
  });

  it("projects create-from-zero draft resumes into the workspace without staged edits", () => {
    const events = buildWorkflowRuntimeEvents({
      requestId: "req_create_zero_draft",
      threadId: "agent_create_from_zero",
      request: createFromZeroRequest(),
      result: {
        ...parsedResult({ proposedOperations: [] }),
        message: {
          id: "msg_create_zero_draft",
          role: "assistant",
          content: "我先生成一份待确认的简历草稿。",
        },
        draftResume: {
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
          ],
          missingFacts: ["工作经历", "项目经历", "教育背景"],
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "workspace_snapshot",
        workspace: expect.objectContaining({
          resumeId: null,
          mode: "create_from_zero",
          goal: expect.objectContaining({
            resumeTitle: "增长型前端工程师简历草稿",
            targetRole: "增长型前端工程师",
          }),
          draftResume: expect.objectContaining({
            profileSummary: "张三，应届生，上海，React 工程化",
          }),
          changeSets: [],
        }),
      }),
    );
    const workspaceEvent = events.find(
      (event) => event.type === "workspace_snapshot",
    );
    expect(
      Date.parse(
        workspaceEvent?.type === "workspace_snapshot"
          ? workspaceEvent.workspace.updatedAt
          : "",
      ),
    ).not.toBeNaN();
    expect(
      workspaceEvent?.type === "workspace_snapshot"
        ? workspaceEvent.workspace.updatedAt
        : "",
    ).not.toBe("req_create_zero_draft");
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ outcome: { type: "success" } }),
    );
  });
});

function validRequest(): AgentMessageRequest {
  return {
    requestId: "req_runtime",
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
      activeSection: null,
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
  };
}

function createFromZeroRequest(): AgentMessageRequest {
  return {
    requestId: "req_create_zero_draft",
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
  };
}

function parsedResult({
  proposedOperations,
}: {
  proposedOperations: NonNullable<
    Extract<AgentMessageParseResult, { ok: true }>["result"]["proposedOperations"]
  >;
}): Extract<AgentMessageParseResult, { ok: true }>["result"] {
  return {
    message: {
      id: "msg_assistant_1",
      role: "assistant",
      content: "我建议先优化工作经历。",
    },
    toolCalls:
      proposedOperations.length > 0
        ? [
            {
              id: "tool_1",
              name: "resume_update_section",
              status: "completed",
              title: "更新经历",
              summary: "改写工作经历。",
              input: { fieldPath: "experience.0.content" },
              result: { operationIds: ["op_1"] },
            },
          ]
        : [],
    proposedOperations,
  };
}

function resumeOperation(): Extract<
  AgentMessageParseResult,
  { ok: true }
>["result"]["proposedOperations"][number] {
  return {
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
  };
}

function agentSessionSnapshot() {
  return {
    sessionId: "agent_session_resume_abc",
    threadId: "resume_abc",
    resumeId: "resume_abc",
    userIdHash: "sha256:user",
    mode: "optimize_existing" as const,
    status: "waiting_user" as const,
    workflow: {
      workflowId: "resume-diagnose" as const,
      nodeId: "intake_goal",
      loopCount: 1,
      completedNodeIds: [],
    },
    workspace: {
      resumeId: "resume_abc",
      mode: "optimize_existing" as const,
      goal: {
        workflowId: "resume-diagnose",
        resumeTitle: "前端工程师",
        targetRole: "增长型前端工程师",
        locale: "zh-CN" as const,
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
      status: "healthy" as const,
      policy: "full_context" as const,
      sources: [],
      lastCompactionAt: null,
      warnings: [],
    },
    pendingInterrupts: [],
    lastResumeContentHash: null,
    createdAt: "2026-06-12T08:30:00.000Z",
    updatedAt: "2026-06-12T08:45:00.000Z",
  };
}
