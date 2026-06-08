import { describe, expect, it } from "vitest";

import {
  buildResumeHelperPrompt,
  parseResumeHelperProviderResponse,
  validateResumeHelperRequest,
} from "../src/resume-helpers";

describe("resume helper request validation", () => {
  it("accepts a resume diagnosis request", () => {
    const result = validateResumeHelperRequest("resume-diagnose", validResumeBody());

    expect(result).toMatchObject({
      ok: true,
      request: {
        helperId: "resume-diagnose",
        resumeId: "resume_abc",
        locale: "zh-CN",
        target: { kind: "resume" },
        intent: { mode: "diagnose", maxSuggestions: 5, strategy: "star" },
      },
    });
  });

  it("requires section target data for section-next-steps", () => {
    const body = validResumeBody({
      target: { kind: "resume", section: null, fieldPath: null },
      intent: { mode: "next_steps", maxSuggestions: 3, strategy: "star" },
    });

    const result = validateResumeHelperRequest("section-next-steps", body);

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      error: "bad_request",
      message: "target.section is required for section-next-steps",
    });
  });

  it("rejects helper context that exceeds the plain text limit", () => {
    const result = validateResumeHelperRequest(
      "resume-diagnose",
      validResumeBody({
        context: {
          ...validResumeBody().context,
          sections: [
            {
              key: "experience",
              label: "工作经历",
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
});

describe("resume helper prompt", () => {
  it("forbids fabricated facts and keeps STAR as suggestion guidance", () => {
    const validation = validateResumeHelperRequest("resume-diagnose", validResumeBody());
    if (!validation.ok) throw new Error("expected valid request");

    const prompt = buildResumeHelperPrompt({
      ...validation.request,
      requestId: "req_helper",
    });

    expect(prompt.system).toContain("不得编造事实、数字、公司、学校、职位、技术栈、奖项或结果");
    expect(prompt.developer).toContain("输出必须是合法 JSON");
    expect(prompt.developer).toContain("STAR");
    expect(prompt.user).toContain("工作经历");
    expect(prompt.user).toContain("负责业务系统前端开发");
  });
});

describe("resume helper provider response parser", () => {
  it("parses structured suggestions", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({
        summary: "整体内容完整，但经历结果不足。",
        suggestions: [
          {
            id: "sug_experience_result",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "补充经历结果",
            rationale: "当前只描述动作，没有说明影响。",
            actionLabel: "补充结果",
            example: "如果你有真实数据，可以补充性能、转化或交付周期变化。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "结果数据必须由用户提供。",
              },
            ],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        summary: "整体内容完整，但经历结果不足。",
        suggestions: [
          {
            id: "sug_experience_result",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "补充经历结果",
            rationale: "当前只描述动作，没有说明影响。",
            actionLabel: "补充结果",
            example: "如果你有真实数据，可以补充性能、转化或交付周期变化。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "结果数据必须由用户提供。",
              },
            ],
          },
        ],
      },
    });
  });

  it("rejects suggestions with unsupported risk flags", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({
        summary: "整体内容完整。",
        suggestions: [
          {
            id: "sug_bad",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "补充结果",
            rationale: "缺少结果。",
            actionLabel: "补充结果",
            example: "",
            riskFlags: [{ type: "unknown", message: "bad" }],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: false,
      message: "Provider riskFlags are invalid",
    });
  });
});

function validResumeBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    target: {
      kind: "resume",
      section: null,
      fieldPath: null,
    },
    context: {
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [
          { key: "experience", label: "工作经历", score: 7, max: 10 },
        ],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    intent: {
      mode: "diagnose",
      maxSuggestions: 5,
      strategy: "star",
    },
    ...overrides,
  };
}
