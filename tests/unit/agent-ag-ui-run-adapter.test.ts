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
