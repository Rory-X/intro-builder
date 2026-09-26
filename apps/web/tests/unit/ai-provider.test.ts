import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Provider 装配层的行为契约（P04 任务 2 + 7）。
 *
 * 这一层把「用户填的 BYOK 配置」变成编排层可用的 `streamModel`。它是
 * **唯一**把用户可控 URL / apiKey 交给网络的地方，因此三条边界必须守住：
 *
 * 1. **出站前校验**：非法地址（http、内网、metadata、userinfo）绝不发起请求。
 * 2. **密钥不泄漏**：错误信息、返回值都不能带 apiKey 或完整 baseUrl。
 * 3. **预算与取消透传**：`abortSignal`、`maxSteps` 必须真的传下去 ——
 *    传丢了就会变成「取消无效」与「无限步数」，且不会有任何报错。
 */

const streamTextMock = vi.fn();
const createProviderMock = vi.fn();

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: (...args: unknown[]) => streamTextMock(...args) };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (...args: unknown[]) => createProviderMock(...args),
}));

type Config = { baseUrl: string; apiKey: string; modelName: string };

function config(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-secret-value",
    modelName: "gpt-4o-mini",
    ...overrides,
  };
}

async function loadModule() {
  return import("@/lib/ai/provider");
}

describe("provider 装配", () => {
  beforeEach(() => {
    vi.resetModules();
    streamTextMock.mockReset();
    createProviderMock.mockReset();
    createProviderMock.mockReturnValue(() => ({ __model: true }));
    streamTextMock.mockReturnValue({ fullStream: (async function* () {})() });
  });

  it("合法配置能创建 provider，且**创建时不发起模型调用**", async () => {
    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config());

    expect(result.ok).toBe(true);
    expect(createProviderMock).toHaveBeenCalledTimes(1);
    const providerArgs = createProviderMock.mock.calls[0][0] as Record<string, unknown>;
    expect(providerArgs.baseURL).toBe("https://api.example.com/v1");
    expect(providerArgs.apiKey).toBe("sk-secret-value");

    /*
     * 关键契约：构造 streamModel **不**等于开始一次模型调用。
     *
     * 「打开面板/刷新页面就烧一次额度」这类问题的根源就是构造即调用。
     * 模型调用只能发生在真正消费流的时候。
     */
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("开始消费流时才创建 SDK 调用，且绑定到指定模型名", async () => {
    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config({ modelName: "gpt-4o-mini" }));
    if (!result.ok) throw new Error("预期配置合法");

    for await (const _part of result.streamModel({
      system: "",
      messages: [],
      tools: {},
      abortSignal: new AbortController().signal,
      maxSteps: 1,
    })) {
      void _part;
    }

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect((streamTextMock.mock.calls[0][0] as Record<string, unknown>).model).toEqual({
      __model: true,
    });
  });

  it("http 地址被拒，且**不**创建 provider、不发起请求", async () => {
    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config({ baseUrl: "http://api.example.com/v1" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insecure_protocol");
    expect(createProviderMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("内网与 metadata 地址被拒，不发起请求", async () => {
    const { createProviderStreamer } = await loadModule();
    const bad = [
      "https://127.0.0.1/v1",
      "https://192.168.1.10/v1",
      "https://10.0.0.5/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/v1",
      "https://intranet/v1",
    ];
    for (const baseUrl of bad) {
      const result = createProviderStreamer(config({ baseUrl }));
      expect(result.ok).toBe(false);
    }
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("含 userinfo 的地址被拒", async () => {
    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(
      config({ baseUrl: "https://user:pass@api.example.com/v1" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("userinfo_not_allowed");
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("缺少任一字段都被拒", async () => {
    const { createProviderStreamer } = await loadModule();
    expect(createProviderStreamer(config({ baseUrl: "" })).ok).toBe(false);
    expect(createProviderStreamer(config({ apiKey: "" })).ok).toBe(false);
    expect(createProviderStreamer(config({ apiKey: "   " })).ok).toBe(false);
    expect(createProviderStreamer(config({ modelName: "" })).ok).toBe(false);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("拒绝结果里**不**包含 apiKey", async () => {
    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config({ baseUrl: "http://api.example.com/v1" }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk-secret-value");
  });

  it("调用时把 abortSignal 与 maxSteps 透传给 SDK", async () => {
    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config());
    if (!result.ok) throw new Error("预期配置合法");

    const controller = new AbortController();
    const stream = result.streamModel({
      system: "你是助手",
      messages: [{ role: "user", content: "你好" }],
      tools: { readResume: {} },
      abortSignal: controller.signal,
      maxSteps: 4,
    });
    // 消费一下，确保它是可迭代的。
    for await (const _part of stream) void _part;

    const args = streamTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.abortSignal).toBe(controller.signal);
    expect(args.system).toBe("你是助手");
    expect(args.tools).toEqual({ readResume: {} });
    // 步数预算必须体现为 SDK 的 stopWhen（传丢会变成无上限）。
    expect(args.stopWhen).toBeDefined();
  });

  it("SDK 片段原样透出（不在这里解释协议）", async () => {
    const parts = [
      { type: "start" },
      { type: "text-delta", id: "t", text: "hi" },
      { type: "finish", finishReason: "stop" },
    ];
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        for (const part of parts) yield part;
      })(),
    });

    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config());
    if (!result.ok) throw new Error("预期配置合法");

    const collected: unknown[] = [];
    for await (const part of result.streamModel({
      system: "",
      messages: [],
      tools: {},
      abortSignal: new AbortController().signal,
      maxSteps: 1,
    })) {
      collected.push(part);
    }

    // 适配器负责解释协议；装配层只搬运。
    expect(collected).toEqual(parts);
  });

  it("SDK 抛出的错误不把 apiKey 带进消息", async () => {
    streamTextMock.mockImplementation(() => {
      throw new Error("connect failed to https://api.example.com/v1?key=sk-secret-value");
    });

    const { createProviderStreamer } = await loadModule();
    const result = createProviderStreamer(config());
    if (!result.ok) throw new Error("预期配置合法");

    let thrown: unknown = null;
    try {
      for await (const _part of result.streamModel({
        system: "",
        messages: [],
        tools: {},
        abortSignal: new AbortController().signal,
        maxSteps: 1,
      })) {
        void _part;
      }
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("sk-secret-value");
  });
});
