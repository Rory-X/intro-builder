import { describe, expect, it, vi } from "vitest";

import { runPolish, type PolishModelConfig } from "@/lib/ai/capabilities/polish-runner";

/**
 * 润色执行器的行为契约（P05 任务 4）。
 *
 * 这是取代旧微服务 HTTP 转发的那一层。它错了不会有编译或类型错误，
 * 只会让「润色按钮」表现异常，因此每条边界都要锁住：
 *
 * 1. **校验前置**：请求不合法就**不调用模型**（省额度，也让错误更快到达用户）。
 * 2. **地址策略**：与对话路径同一套判据（非 https、内网、metadata 一律拒绝）。
 * 3. **密钥不外泄**：模型调用失败时，错误消息里不能出现 apiKey 或完整 baseUrl。
 * 4. **解析失败要保留原因**：「模型返回的 JSON 缺字段」与「网络失败」
 *    是两类完全不同的排查方向，不能都回一句「润色失败」。
 */

const config: PolishModelConfig = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-secret-value",
  modelName: "gpt-4o-mini",
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume-1",
    section: "summary",
    fieldPath: "summary",
    locale: "zh-CN",
    content: { format: "plain_text", plainText: "负责接口优化。" },
    ...overrides,
  };
}

const OK_RESPONSE = JSON.stringify({
  polishedText: "负责订单查询接口开发。",
  changeSummary: "更具体",
  riskFlags: [],
});

describe("校验前置（不合法就不调用模型）", () => {
  it("请求不合法返回 400 且**不调用模型**", async () => {
    const callModel = vi.fn();
    const outcome = await runPolish({}, config, { callModel });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(400);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("超长输入返回 413 且不调用模型", async () => {
    const callModel = vi.fn();
    const outcome = await runPolish(
      validBody({ content: { format: "plain_text", plainText: "字".repeat(4001) } }),
      config,
      { callModel },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(413);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("非法 provider 地址返回 400 且不调用模型", async () => {
    const callModel = vi.fn();
    for (const baseUrl of [
      "http://api.example.com/v1",
      "https://127.0.0.1/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pass@api.example.com/v1",
    ]) {
      const outcome = await runPolish(validBody(), { ...config, baseUrl }, { callModel });
      expect(outcome.ok, baseUrl).toBe(false);
      if (!outcome.ok) expect(outcome.status, baseUrl).toBe(400);
    }
    expect(callModel).not.toHaveBeenCalled();
  });

  it("缺 key 或 modelName 返回 400 且不调用模型", async () => {
    const callModel = vi.fn();
    expect((await runPolish(validBody(), { ...config, apiKey: "  " }, { callModel })).ok).toBe(false);
    expect((await runPolish(validBody(), { ...config, modelName: "" }, { callModel })).ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("成功路径", () => {
  it("返回结构化结果与 token 用量", async () => {
    const callModel = vi.fn().mockResolvedValue({
      content: OK_RESPONSE,
      inputTokens: 120,
      outputTokens: 30,
    });
    const outcome = await runPolish(validBody(), config, { callModel });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("预期成功");
    expect(outcome.result.polishedText).toBe("负责订单查询接口开发。");
    expect(outcome.result.format).toBe("plain_text");
    expect(outcome.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it("把 core 与原文一起交给模型（system 含新 core）", async () => {
    const callModel = vi.fn().mockResolvedValue({ content: OK_RESPONSE, inputTokens: 1, outputTokens: 1 });
    await runPolish(validBody(), config, { callModel });

    const args = callModel.mock.calls[0][0] as { system: string; prompt: string };
    expect(args.system).toContain("你是中文简历编辑助手");
    expect(args.prompt).toContain("负责接口优化。");
  });

  it("TipTap 模式下把 textBlockCount 传给模型", async () => {
    const callModel = vi.fn().mockResolvedValue({ content: OK_RESPONSE, inputTokens: 1, outputTokens: 1 });
    const tiptapJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "一" }] },
        { type: "paragraph", content: [{ type: "text", text: "二" }] },
      ],
    };
    await runPolish(
      validBody({ content: { format: "tiptap_json", plainText: "一\n二", tiptapJson } }),
      config,
      { callModel },
    );
    const args = callModel.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain("textBlockCount=2");
  });

  it("TipTap 模式下返回替换后的文档", async () => {
    const callModel = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        polishedText: "一改\n二改",
        polishedBlocks: ["一改", "二改"],
        changeSummary: "s",
        riskFlags: [],
      }),
      inputTokens: 1,
      outputTokens: 1,
    });
    const tiptapJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "一" }] },
        { type: "paragraph", content: [{ type: "text", text: "二" }] },
      ],
    };
    const outcome = await runPolish(
      validBody({ content: { format: "tiptap_json", plainText: "一\n二", tiptapJson } }),
      config,
      { callModel },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("预期成功");
    expect(outcome.result.format).toBe("tiptap_json");
  });
});

describe("失败路径保留原因", () => {
  it("模型返回非法 JSON → provider_response_invalid，消息含 invalid JSON", async () => {
    const callModel = vi.fn().mockResolvedValue({ content: "不是 JSON", inputTokens: 1, outputTokens: 1 });
    const outcome = await runPolish(validBody(), config, { callModel });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("provider_response_invalid");
      expect(outcome.message).toContain("invalid JSON");
    }
  });

  it("模型返回缺字段 → 消息指明缺哪一项（与网络失败可区分）", async () => {
    const callModel = vi.fn().mockResolvedValue({
      content: JSON.stringify({ polishedText: "a" }),
      inputTokens: 1,
      outputTokens: 1,
    });
    const outcome = await runPolish(validBody(), config, { callModel });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("provider_response_invalid");
      expect(outcome.message).toContain("changeSummary");
    }
  });

  it("模型调用抛异常 → provider_unavailable", async () => {
    const callModel = vi.fn().mockRejectedValue(new Error("network down"));
    const outcome = await runPolish(validBody(), config, { callModel });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("provider_unavailable");
      expect(outcome.message).toContain("network down");
    }
  });

  it("**密钥不外泄**：调用失败时消息里没有 apiKey", async () => {
    const callModel = vi.fn().mockRejectedValue(
      new Error("connect failed to https://api.example.com/v1?key=sk-secret-value"),
    );
    const outcome = await runPolish(validBody(), config, { callModel });
    expect(outcome.ok).toBe(false);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("sk-secret-value");
    // baseUrl 只保留 protocol//host。
    expect(serialized).toContain("https://api.example.com");
  });
});
