import type { RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { mapAgUiRunToAgentMessageRequest } from "@/lib/agent/ag-ui-run-adapter";

describe("AG-UI run adapter", () => {
  it("maps AG-UI RunAgentInput plus intro-builder forwarded props to AgentMessageRequest", () => {
    const result = mapAgUiRunToAgentMessageRequest(validRunInput());

    expect(result).toEqual({
      ok: true,
      request: {
        resumeId: "resume_abc",
        locale: "zh-CN",
        workflowId: "experience-star",
        messages: [
          {
            id: "msg_user_1",
            role: "user",
            content: "帮我优化第一段经历",
          },
        ],
        context: expect.objectContaining({
          resumeTitle: "前端工程师",
          templateId: "professional",
        }),
      },
    });
  });

  it("maps user-provided model preferences without exposing transport setting names", () => {
    const result = mapAgUiRunToAgentMessageRequest({
      ...validRunInput(),
      forwardedProps: {
        introBuilder: {
          ...validRunInput().forwardedProps.introBuilder,
          modelConfig: {
            baseUrl: "https://models.example.test/v1",
            apiKey: "sk-test-local",
            modelName: "gpt-5-mini",
          },
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      request: expect.objectContaining({
        modelConfig: {
          baseUrl: "https://models.example.test/v1",
          apiKey: "sk-test-local",
          modelName: "gpt-5-mini",
        },
      }),
    });
    expect(JSON.stringify(result)).not.toContain("AGENT_MODEL");
  });

  it("maps question interrupt answers into follow-up context", () => {
    const result = mapAgUiRunToAgentMessageRequest({
      ...validRunInput(),
      resume: [
        {
          interruptId: "question_target_role",
          status: "resolved",
          payload: { answer: "增长型前端工程师" },
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      request: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.stringContaining(
              "用户已补充 Agent 需要的信息",
            ),
          }),
        ]),
      }),
    });
    if (!result.ok) throw new Error("expected adapter success");
    expect(result.request.messages.at(-1)?.content).toContain(
      "question_target_role：增长型前端工程师",
    );
    expect(result.request.messages.at(-1)?.content).not.toContain("已拒绝");
  });

  it("maps create-from-zero forwarded props without requiring an existing resume snapshot", () => {
    const result = mapAgUiRunToAgentMessageRequest({
      ...validRunInput(),
      threadId: "agent_create_from_zero",
      forwardedProps: {
        introBuilder: {
          resumeId: null,
          mode: "create_from_zero",
          locale: "zh-CN",
          workflowId: "create-from-zero",
          context: null,
        },
      },
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
            id: "msg_user_1",
            role: "user",
            content: "帮我优化第一段经历",
          },
        ],
        context: null,
      },
    });
  });

  it("rejects RunAgentInput without intro-builder metadata", () => {
    const result = mapAgUiRunToAgentMessageRequest({
      ...validRunInput(),
      forwardedProps: {},
    });

    expect(result).toEqual({
      ok: false,
      message: "forwardedProps.introBuilder is required",
    });
  });

  it("rejects unsupported locales before signing an Agent token", () => {
    const result = mapAgUiRunToAgentMessageRequest({
      ...validRunInput(),
      forwardedProps: {
        introBuilder: {
          ...validIntroBuilderProps(),
          locale: "en-US",
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "locale must be zh-CN",
    });
  });
});

function validRunInput(): RunAgentInput {
  return {
    threadId: "resume_abc",
    runId: "run_1",
    state: null,
    messages: [
      {
        id: "msg_user_1",
        role: "user",
        content: "帮我优化第一段经历",
      },
    ],
    tools: [],
    context: [],
    forwardedProps: {
      introBuilder: validIntroBuilderProps(),
    },
  };
}

function validIntroBuilderProps() {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    workflowId: "experience-star",
    context: {
      resumeTitle: "前端工程师",
      templateId: "professional",
      activeSection: "experience",
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
  };
}
