import { describe, expect, it, vi } from "vitest";

import {
  buildResumeHelperPrompt,
  countSuggestionOverflow,
  parseResumeHelperProviderResponse,
  validateResumeHelperRequest,
} from "@/lib/ai/capabilities/resume-helpers";
import { runResumeHelper } from "@/lib/ai/capabilities/resume-helper-runner";
import { CORE_V1 } from "@/lib/ai/prompts/core";

/**
 * 简历 Helper 迁移契约（P05 任务 4）。
 *
 * 这些函数逐字移植自 `apps/agent/src/resume-helpers.ts`。迁移正确性的判据是
 * **行为一致**，因此断言取自微服务侧既有测试的预期。
 *
 * 三个 helper 特有的关键点：
 *
 * 1. **两个 helper 的 target 形状不同且不可混用**：`resume-diagnose` 要求
 *    `kind: "resume"` 且 section/fieldPath 为 null；`section-next-steps` 要求
 *    `kind: "section"`。用错直接拒绝 —— 否则会拿「全份诊断」的提示词去跑
 *    「单区块建议」。
 * 2. **intent.mode 必须与 helperId 匹配**（同上，两者产出结构不同）。
 * 3. **建议数量超限不算解析失败**：内容可用，只是模型没守 maxSuggestions。
 */

const VALID_SECTION_CONTEXT = {
  resumeTitle: "前端工程师",
  completeness: {
    overall: 62,
    sections: [{ key: "experience", label: "工作经历", score: 3, max: 5 }],
  },
  sections: [{ key: "experience", label: "工作经历", plainText: "参与订单系统开发。" }],
};

function diagnoseBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume-1",
    locale: "zh-CN",
    target: { kind: "resume", section: null, fieldPath: null },
    context: VALID_SECTION_CONTEXT,
    intent: { mode: "diagnose", maxSuggestions: 3, strategy: "plain" },
    ...overrides,
  };
}

function nextStepsBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume-1",
    locale: "zh-CN",
    target: { kind: "section", section: "experience", fieldPath: null },
    context: VALID_SECTION_CONTEXT,
    intent: { mode: "next_steps", maxSuggestions: 3, strategy: "star" },
    ...overrides,
  };
}

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    section: "experience",
    fieldPath: "experience.0.content",
    severity: "high",
    title: "补充具体职责",
    rationale: "当前只写了参与，看不出你做了什么。",
    actionLabel: "补充职责",
    example: "负责订单查询接口开发。",
    riskFlags: [],
    ...overrides,
  };
}

const OK_RESPONSE = JSON.stringify({
  summary: "整体方向正确，建议补充职责细节。",
  suggestions: [suggestion()],
});

describe("请求校验：两个 helper 的形状不可混用", () => {
  it("resume-diagnose 接受 kind=resume 且 section/fieldPath 为 null", () => {
    const result = validateResumeHelperRequest(diagnoseBody(), "resume-diagnose");
    expect(result.ok).toBe(true);
  });

  it("resume-diagnose 拒绝 kind=section（否则会拿全份诊断提示词跑单区块）", () => {
    const result = validateResumeHelperRequest(
      diagnoseBody({ target: { kind: "section", section: "experience", fieldPath: null } }),
      "resume-diagnose",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("target");
  });

  it("resume-diagnose 拒绝 section 非 null 的 kind=resume", () => {
    const result = validateResumeHelperRequest(
      diagnoseBody({ target: { kind: "resume", section: "experience", fieldPath: null } }),
      "resume-diagnose",
    );
    expect(result.ok).toBe(false);
  });

  it("section-next-steps 接受 kind=section", () => {
    const result = validateResumeHelperRequest(nextStepsBody(), "section-next-steps");
    expect(result.ok).toBe(true);
  });

  it("section-next-steps 拒绝 kind=resume", () => {
    const result = validateResumeHelperRequest(
      nextStepsBody({ target: { kind: "resume", section: null, fieldPath: null } }),
      "section-next-steps",
    );
    expect(result.ok).toBe(false);
  });

  it("intent.mode 必须与 helperId 匹配", () => {
    // 诊断请求配 next_steps mode → 拒绝。
    expect(
      validateResumeHelperRequest(
        diagnoseBody({ intent: { mode: "next_steps", maxSuggestions: 3, strategy: "plain" } }),
        "resume-diagnose",
      ).ok,
    ).toBe(false);
    // 下一步请求配 diagnose mode → 拒绝。
    expect(
      validateResumeHelperRequest(
        nextStepsBody({ intent: { mode: "diagnose", maxSuggestions: 3, strategy: "star" } }),
        "section-next-steps",
      ).ok,
    ).toBe(false);
  });

  it("maxSuggestions 必须在 1..5 且为整数", () => {
    for (const bad of [0, 6, 2.5, -1]) {
      expect(
        validateResumeHelperRequest(
          diagnoseBody({ intent: { mode: "diagnose", maxSuggestions: bad, strategy: "plain" } }),
          "resume-diagnose",
        ).ok,
        String(bad),
      ).toBe(false);
    }
  });

  it("context.sections 不能为空", () => {
    const result = validateResumeHelperRequest(
      diagnoseBody({ context: { ...VALID_SECTION_CONTEXT, sections: [] } }),
      "resume-diagnose",
    );
    expect(result.ok).toBe(false);
  });

  it("跨区块文本累计超过 12000 字返回 **413**", () => {
    const long = "字".repeat(6001);
    const result = validateResumeHelperRequest(
      diagnoseBody({
        context: {
          ...VALID_SECTION_CONTEXT,
          sections: [
            { key: "a", label: "A", plainText: long },
            { key: "b", label: "B", plainText: long },
          ],
        },
      }),
      "resume-diagnose",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.statusCode).toBe(413);
  });

  it("恰好 12000 字通过（边界不含糊）", () => {
    const result = validateResumeHelperRequest(
      diagnoseBody({
        context: {
          ...VALID_SECTION_CONTEXT,
          sections: [{ key: "a", label: "A", plainText: "字".repeat(12_000) }],
        },
      }),
      "resume-diagnose",
    );
    expect(result.ok).toBe(true);
  });

  it("缺 resumeId / locale 非 zh-CN 返回 400", () => {
    expect(validateResumeHelperRequest(diagnoseBody({ resumeId: undefined }), "resume-diagnose").ok).toBe(false);
    expect(validateResumeHelperRequest(diagnoseBody({ locale: "en" }), "resume-diagnose").ok).toBe(false);
  });

  it("context 形状不合法（completeness 缺 overall）被拒", () => {
    const result = validateResumeHelperRequest(
      diagnoseBody({
        context: { ...VALID_SECTION_CONTEXT, completeness: { sections: [] } },
      }),
      "resume-diagnose",
    );
    expect(result.ok).toBe(false);
  });
});

describe("响应解析", () => {
  it("解析出 summary 与 suggestions", () => {
    const parsed = parseResumeHelperProviderResponse(OK_RESPONSE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("预期成功");
    expect(parsed.result.summary).toContain("建议补充职责细节");
    expect(parsed.result.suggestions).toHaveLength(1);
    expect(parsed.result.suggestions[0].title).toBe("补充具体职责");
  });

  it("缺 summary / suggestions 各自拒绝并指明原因", () => {
    const noSummary = parseResumeHelperProviderResponse(JSON.stringify({ suggestions: [] }));
    expect(noSummary.ok).toBe(false);
    if (!noSummary.ok) expect(noSummary.message).toContain("summary");

    const noSuggestions = parseResumeHelperProviderResponse(JSON.stringify({ summary: "x" }));
    expect(noSuggestions.ok).toBe(false);
    if (!noSuggestions.ok) expect(noSuggestions.message).toContain("suggestions");
  });

  it("非法 JSON 与「不是对象」都拒绝，消息可区分", () => {
    const notJson = parseResumeHelperProviderResponse("not json");
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.message).toContain("invalid JSON");

    const notObject = parseResumeHelperProviderResponse('"str"');
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.message).toContain("JSON object");
  });

  it("建议缺任一必填字段即整体拒绝，并指明缺哪个", () => {
    for (const field of ["id", "section", "fieldPath", "title", "rationale", "actionLabel"]) {
      const payload = JSON.stringify({
        summary: "s",
        suggestions: [suggestion({ [field]: undefined })],
      });
      const parsed = parseResumeHelperProviderResponse(payload);
      expect(parsed.ok, field).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain(field);
    }
  });

  it("severity 必须在封闭集合内", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({ summary: "s", suggestions: [suggestion({ severity: "urgent" })] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("severity");
  });

  it("example 允许为空字符串（写作方向可能留空），但必须存在", () => {
    const empty = parseResumeHelperProviderResponse(
      JSON.stringify({ summary: "s", suggestions: [suggestion({ example: "" })] }),
    );
    expect(empty.ok).toBe(true);

    const missing = parseResumeHelperProviderResponse(
      JSON.stringify({ summary: "s", suggestions: [suggestion({ example: undefined })] }),
    );
    expect(missing.ok).toBe(false);
  });

  it("riskFlags 类型必须在封闭集合内", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({
        summary: "s",
        suggestions: [suggestion({ riskFlags: [{ type: "made_up", message: "x" }] })],
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("接受四种已知 riskFlag 类型", () => {
    for (const type of ["needs_user_fact", "possible_fabrication", "too_little_context", "formatting_risk"]) {
      const parsed = parseResumeHelperProviderResponse(
        JSON.stringify({ summary: "s", suggestions: [suggestion({ riskFlags: [{ type, message: "m" }] })] }),
      );
      expect(parsed.ok, type).toBe(true);
    }
  });

  it("空白字段被 trim（返回稳定形状）", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({ summary: "  摘要  ", suggestions: [suggestion({ title: "  标题  " })] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("预期成功");
    expect(parsed.result.summary).toBe("摘要");
    expect(parsed.result.suggestions[0].title).toBe("标题");
  });
});

describe("建议数量超限（不是解析失败）", () => {
  it("countSuggestionOverflow 计算超出量", () => {
    const result = { summary: "s", suggestions: [suggestion(), suggestion({ id: "s2" }), suggestion({ id: "s3" })] };
    expect(countSuggestionOverflow(result, 2)).toBe(1);
    expect(countSuggestionOverflow(result, 5)).toBe(0);
    expect(countSuggestionOverflow(result, 1)).toBe(2);
  });
});

describe("提示词", () => {
  it("注入新 core，同时保留 helper 特有的 5 条严格规则", () => {
    const validated = validateResumeHelperRequest(diagnoseBody(), "resume-diagnose");
    if (!validated.ok) throw new Error("预期校验通过");
    const prompt = buildResumeHelperPrompt(validated.request, CORE_V1);
    expect(prompt.system).toContain("你是中文简历编辑助手");
    expect(prompt.system).toContain("不得编造事实");
    expect(prompt.system).toContain("needs_user_fact");
  });

  it("user 段把「完成度」与「文本片段」分开（估算不混进事实）", () => {
    const validated = validateResumeHelperRequest(diagnoseBody(), "resume-diagnose");
    if (!validated.ok) throw new Error("预期校验通过");
    const prompt = buildResumeHelperPrompt(validated.request, CORE_V1);
    expect(prompt.user).toContain("完成度");
    expect(prompt.user).toContain("简历文本片段");
    expect(prompt.user).toContain("参与订单系统开发");
  });

  it("developer 段带上 helperId / strategy / maxSuggestions", () => {
    const validated = validateResumeHelperRequest(nextStepsBody(), "section-next-steps");
    if (!validated.ok) throw new Error("预期校验通过");
    const prompt = buildResumeHelperPrompt(validated.request, CORE_V1);
    expect(prompt.developer).toContain("helperId=section-next-steps");
    expect(prompt.developer).toContain("strategy=star");
    expect(prompt.developer).toContain("maxSuggestions=3");
  });
});

describe("runner", () => {
  const config = { baseUrl: "https://api.example.com/v1", apiKey: "sk-secret", modelName: "m" };

  it("校验失败时不调用模型", async () => {
    const callModel = vi.fn();
    const outcome = await runResumeHelper({}, "resume-diagnose", config, { callModel });
    expect(outcome.ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("非法地址不调用模型", async () => {
    const callModel = vi.fn();
    const outcome = await runResumeHelper(diagnoseBody(), "resume-diagnose", {
      ...config,
      baseUrl: "http://127.0.0.1/v1",
    }, { callModel });
    expect(outcome.ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("成功时返回结果与用量", async () => {
    const callModel = vi.fn().mockResolvedValue({ content: OK_RESPONSE, inputTokens: 50, outputTokens: 20 });
    const outcome = await runResumeHelper(diagnoseBody(), "resume-diagnose", config, { callModel });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("预期成功");
    expect(outcome.result.suggestions).toHaveLength(1);
    expect(outcome.usage).toEqual({ inputTokens: 50, outputTokens: 20 });
    expect(outcome.truncated).toBe(0);
  });

  it("建议超限时**截断并如实回报**，不整体失败", async () => {
    const many = JSON.stringify({
      summary: "s",
      suggestions: [suggestion({ id: "s1" }), suggestion({ id: "s2" }), suggestion({ id: "s3" })],
    });
    const callModel = vi.fn().mockResolvedValue({ content: many, inputTokens: 1, outputTokens: 1 });
    const outcome = await runResumeHelper(
      diagnoseBody({ intent: { mode: "diagnose", maxSuggestions: 2, strategy: "plain" } }),
      "resume-diagnose",
      config,
      { callModel },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("预期成功");
    // 内容可用，因此成功；但如实回报被截掉一条。
    expect(outcome.result.suggestions).toHaveLength(2);
    expect(outcome.truncated).toBe(1);
  });

  it("模型返回不符约定 → provider_response_invalid（保留原因）", async () => {
    const callModel = vi.fn().mockResolvedValue({ content: JSON.stringify({ summary: "s" }), inputTokens: 1, outputTokens: 1 });
    const outcome = await runResumeHelper(diagnoseBody(), "resume-diagnose", config, { callModel });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("provider_response_invalid");
      expect(outcome.message).toContain("suggestions");
    }
  });

  it("调用失败 → provider_unavailable，且密钥不外泄", async () => {
    const callModel = vi.fn().mockRejectedValue(
      new Error("connect failed to https://api.example.com/v1?key=sk-secret"),
    );
    const outcome = await runResumeHelper(diagnoseBody(), "resume-diagnose", config, { callModel });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("provider_unavailable");
    expect(JSON.stringify(outcome)).not.toContain("sk-secret");
  });

  it("把 core 与上下文一起交给模型", async () => {
    const callModel = vi.fn().mockResolvedValue({ content: OK_RESPONSE, inputTokens: 1, outputTokens: 1 });
    await runResumeHelper(diagnoseBody(), "resume-diagnose", config, { callModel });
    const args = callModel.mock.calls[0][0] as { system: string; prompt: string };
    expect(args.system).toContain("你是中文简历编辑助手");
    expect(args.prompt).toContain("参与订单系统开发");
  });
});
