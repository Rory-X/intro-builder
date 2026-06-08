import { describe, expect, it } from "vitest";

import {
  buildRichTextPolishPrompt,
  parsePolishProviderResponse,
  validateRichTextPolishRequest,
} from "../src/rich-text-polish";

describe("rich text polish prompt", () => {
  it("builds a conservative STAR-aware Chinese resume polish prompt", () => {
    const prompt = buildRichTextPolishPrompt({
      requestId: "req_prompt",
      resumeId: "resume_abc",
      section: "experience",
      fieldPath: "experience.0.content",
      locale: "zh-CN",
      content: {
        format: "tiptap_json",
        plainText: "负责业务系统前端开发，优化页面性能。",
        tiptapJson: { type: "doc", content: [] },
      },
      intent: {
        mode: "polish",
        tone: "professional",
        length: "same",
        strategy: "star",
      },
    });

    expect(prompt.system).toContain("中文简历润色助手");
    expect(prompt.system).toContain("不得新增事实");
    expect(prompt.system).toContain("不得把“参与”改成“主导”");
    expect(prompt.developer).toContain("合法 JSON");
    expect(prompt.developer).toContain("strategy=star");
    expect(prompt.developer).toContain("Situation");
    expect(prompt.developer).toContain("Result");
    expect(prompt.user).toContain("section: experience");
    expect(prompt.user).toContain("负责业务系统前端开发，优化页面性能。");
  });

  it("defaults experience and projects requests to STAR strategy", () => {
    const result = validateRichTextPolishRequest({
      resumeId: "resume_abc",
      section: "projects",
      fieldPath: "projects.0.content",
      locale: "zh-CN",
      content: {
        format: "tiptap_json",
        plainText: "参与订单系统重构。",
        tiptapJson: { type: "doc", content: [] },
      },
      intent: {
        mode: "polish",
        tone: "professional",
        length: "same",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.intent.strategy).toBe("star");
    }
  });

  it("rejects empty or oversized polish input", () => {
    expect(
      validateRichTextPolishRequest({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "tiptap_json",
          plainText: "   ",
          tiptapJson: { type: "doc", content: [] },
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: "bad_request",
      message: "content.plainText is required",
    });

    expect(
      validateRichTextPolishRequest({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "plain_text",
          plainText: "字".repeat(4_001),
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    ).toEqual({
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: "content.plainText must be at most 4000 characters",
    });
  });

  it("parses provider JSON output into the stable response shape", () => {
    const parsed = parsePolishProviderResponse(
      JSON.stringify({
        polishedText: "负责核心业务系统前端开发，持续优化页面性能与交互体验。",
        changeSummary: "优化措辞，使表达更专业。",
        riskFlags: [
          {
            type: "too_little_context",
            message: "原文缺少可量化结果，已按现有信息保守润色。",
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        format: "plain_text",
        polishedText: "负责核心业务系统前端开发，持续优化页面性能与交互体验。",
        changeSummary: "优化措辞，使表达更专业。",
        riskFlags: [
          {
            type: "too_little_context",
            message: "原文缺少可量化结果，已按现有信息保守润色。",
          },
        ],
      },
    });
  });
});
