import { EventType, type BaseEvent } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  createAgUiSseStream,
  extractAgUiContextStatus,
  extractAgUiQuestion,
  extractAgUiResumeWorkspace,
  extractAgUiResumeToolResult,
  readAgUiSseStream,
} from "@/lib/agent/ag-ui-stream";

describe("AG-UI stream helpers", () => {
  it("encodes AG-UI events as text/event-stream", async () => {
    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "thread_1",
      runId: "run_1",
    };

    const response = new Response(createAgUiSseStream([event]), {
      headers: { "content-type": "text/event-stream" },
    });

    await expect(response.text()).resolves.toBe(
      `data: ${JSON.stringify(event)}\n\n`,
    );
  });

  it("parses AG-UI SSE events split across arbitrary chunks", async () => {
    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId: "thread_1", runId: "run_1" },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "msg_1",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg_1",
        delta: "先检查",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "msg_1" },
      { type: EventType.RUN_FINISHED, threadId: "thread_1", runId: "run_1" },
    ];
    const response = new Response(createSplitSseStream(events), {
      headers: { "content-type": "text/event-stream" },
    });

    const parsed: BaseEvent[] = [];
    for await (const event of readAgUiSseStream(response)) {
      parsed.push(event);
    }

    expect(parsed).toEqual(events);
  });

  it("throws a useful error for malformed AG-UI event payloads", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {bad json}\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    await expect(async () => {
      for await (const _event of readAgUiSseStream(response)) {
        void _event;
      }
    }).rejects.toThrow("Invalid AG-UI event JSON");
  });

  it("rejects SSE payloads that are not AG-UI events", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"hello":"world"}\n\n'));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    await expect(async () => {
      for await (const _event of readAgUiSseStream(response)) {
        void _event;
      }
    }).rejects.toThrow("Invalid AG-UI event");
  });

  it("extracts resume tool result operations from AG-UI tool result events", () => {
    const event: BaseEvent = {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "tool_1_result",
      toolCallId: "tool_1",
      role: "tool",
      content: JSON.stringify({
        toolCall: {
          id: "tool_1",
          name: "resume_update_section",
          status: "completed",
          title: "更新个人总结",
          summary: "生成一版更聚焦的个人总结。",
          input: {},
          result: {},
        },
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用个人总结改写",
            section: "summary",
            fieldPath: "basics.summary",
            operation: "update_section",
            beforePlainText: "三年前端经验。",
            afterPlainText: "三年前端工程经验，擅长 React 与工程化交付。",
            changeSummary: "让总结更具体。",
            riskFlags: [],
          },
        ],
      }),
    };

    expect(extractAgUiResumeToolResult(event)).toEqual({
      toolCall: expect.objectContaining({
        id: "tool_1",
        name: "resume_update_section",
      }),
      proposedOperations: [
        expect.objectContaining({
          id: "op_1",
          operation: "update_section",
        }),
      ],
    });
  });

  it("accepts every long-loop tool result used by Agent Mode", () => {
    const toolNames = [
      "resume_read",
      "get_completeness",
      "set_goal",
      "resume_polish_text",
      "resume_set_text",
      "resume_ask",
      "role_match_read",
      "ats_check",
      "content_claim_audit",
      "layout_fit_check",
      "section_quality_score",
    ] as const;

    for (const toolName of toolNames) {
      const event: BaseEvent = {
        type: EventType.TOOL_CALL_RESULT,
        messageId: `${toolName}_result`,
        toolCallId: toolName,
        role: "tool",
        content: JSON.stringify({
          toolCall: {
            id: toolName,
            name: toolName,
            status: "completed",
            title: "内部动作",
            summary: "已完成内部动作。",
            input: {},
            result: {},
          },
          proposedOperations: [],
        }),
      };

      expect(extractAgUiResumeToolResult(event)).toEqual({
        toolCall: expect.objectContaining({ id: toolName, name: toolName }),
        proposedOperations: [],
      });
    }
  });

  it("extracts resume_ask questions from long-loop tool results", () => {
    const event: BaseEvent = {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "tool_ask_result",
      toolCallId: "tool_ask",
      role: "tool",
      content: JSON.stringify({
        toolCall: {
          id: "tool_ask",
          name: "resume_ask",
          status: "completed",
          title: "追问用户",
          summary: "需要补充真实结果指标。",
          input: {},
          result: {},
        },
        question: "这个项目最终提升了哪些指标？",
        field: "experience.0.content",
        proposedOperations: [],
      }),
    };

    expect(extractAgUiQuestion(event)).toEqual({
      toolCallId: "tool_ask",
      question: "这个项目最终提升了哪些指标？",
      field: "experience.0.content",
    });
  });

  it("extracts v2 context status from AG-UI activity snapshots", () => {
    const event: BaseEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_context_status",
      activityType: "context_status",
      content: {
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
    };

    expect(extractAgUiContextStatus(event)).toEqual(
      expect.objectContaining({
        effectiveInputBudgetTokens: 200_000,
        usedInputTokens: 48_000,
        utilization: 0.24,
        status: "healthy",
      }),
    );
  });

  it("extracts v2 context status from AG-UI state deltas", () => {
    const event: BaseEvent = {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/contextStatus",
          value: {
            effectiveInputBudgetTokens: 200_000,
            modelInputLimitTokens: 214_000,
            reservedOutputTokens: 8_000,
            reservedSystemTokens: 6_000,
            usedInputTokens: 152_000,
            utilization: 0.76,
            status: "near_limit",
            policy: "pinned_plus_recent",
            sources: [],
            lastCompactionAt: null,
            warnings: [
              {
                code: "near_limit",
                message: "后续会优先保留当前简历和最近对话。",
              },
            ],
          },
        },
      ],
    };

    expect(extractAgUiContextStatus(event)).toEqual(
      expect.objectContaining({
        effectiveInputBudgetTokens: 200_000,
        status: "near_limit",
        warnings: [
          expect.objectContaining({
            code: "near_limit",
          }),
        ],
      }),
    );
  });

  it("ignores malformed v2 context status payloads", () => {
    const event: BaseEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_context_status",
      activityType: "context_status",
      content: {
        effectiveInputBudgetTokens: 8_000,
        usedInputTokens: "too much",
        utilization: 1,
        status: "healthy",
      },
    };

    expect(extractAgUiContextStatus(event)).toBeNull();
  });

  it("extracts v2 resume workspace from AG-UI activity snapshots", () => {
    const workspace = validWorkspace();
    const event: BaseEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_resume_workspace",
      activityType: "resume_workspace",
      content: workspace,
    };

    expect(extractAgUiResumeWorkspace(event)).toEqual(
      expect.objectContaining({
        resumeId: "resume_abc",
        mode: "optimize_existing",
        changeSets: [
          expect.objectContaining({
            id: "changeset_req_agent",
            operationIds: ["op_1"],
          }),
        ],
      }),
    );
  });

  it("extracts v2 resume workspace from AG-UI state deltas", () => {
    const workspace = validWorkspace();
    const event: BaseEvent = {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/workspace",
          value: workspace,
        },
      ],
    };

    expect(extractAgUiResumeWorkspace(event)).toEqual(
      expect.objectContaining({
        goal: expect.objectContaining({ workflowId: "resume-diagnose" }),
        facts: [expect.objectContaining({ sectionKey: "experience" })],
      }),
    );
  });

  it("ignores malformed v2 resume workspace payloads", () => {
    const event: BaseEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_resume_workspace",
      activityType: "resume_workspace",
      content: {
        resumeId: "resume_abc",
        mode: "optimize_existing",
        changeSets: [{ id: "missing-required-fields" }],
      },
    };

    expect(extractAgUiResumeWorkspace(event)).toBeNull();
  });
});

function validWorkspace() {
  return {
    resumeId: "resume_abc",
    mode: "optimize_existing",
    goal: {
      workflowId: "resume-diagnose",
      resumeTitle: "前端开发工程师",
      targetRole: null,
      locale: "zh-CN",
    },
    facts: [
      {
        id: "fact_experience",
        sectionKey: "experience",
        label: "工作经历 1",
        text: "负责业务系统前端开发，优化页面性能。",
        source: "resume_snapshot",
        confidence: 1,
      },
    ],
    draftResume: null,
    changeSets: [
      {
        id: "changeset_req_agent",
        title: "待确认修改",
        summary: "补足任务与行动。",
        status: "staged",
        operationIds: ["op_1"],
        operations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化。",
            changeSummary: "补足任务与行动。",
            riskFlags: [],
          },
        ],
        createdAt: "req_agent",
      },
    ],
    decisions: [],
    qualityReport: null,
    updatedAt: "req_agent",
  };
}

function createSplitSseStream(events: BaseEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const chunks = [encoded.slice(0, 11), encoded.slice(11, 43), encoded.slice(43)];

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
