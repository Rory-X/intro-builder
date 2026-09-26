import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/ai/runs` 对对话历史的处理（P07 切流的关键前置）。
 *
 * ## 为什么单独测这一层
 *
 * 浮窗是**多轮会话**。此前 `parseBody` 校验了 `history` 的**长度**，
 * 却把内容丢掉，然后 `streamRunAttempt({ history: [] })` 硬编码为空 ——
 * 也就是「验完就扔」。
 *
 * 在还没有客户端消费方时不会暴露；P07 把浮窗切到这条路由后必然暴露：
 * 每一轮都变成「失忆」的第一轮，用户说「再短一点」模型不知道在说什么。
 *
 * 因此这里断言两件事：
 * 1. **合法历史被透传到编排层**（这是「不失忆」的依据）；
 * 2. **非法历史被拒绝**（而不是静默丢弃 —— 缺了中间环节的对话比没有更糟）。
 */

const authMock = vi.fn();
const startRunMock = vi.fn();
const acquireLeaseMock = vi.fn();
const getRunMock = vi.fn();
const streamAttemptMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/ai/run-store", () => ({
  getRun: (...args: unknown[]) => getRunMock(...args),
  startRun: (...args: unknown[]) => startRunMock(...args),
  acquireLease: (...args: unknown[]) => acquireLeaseMock(...args),
  listEvents: async () => [],
}));
vi.mock("@/lib/ai/provider", () => ({
  // 必须带 `ok: true` —— 路由检查它，缺了会走 400 分支（实测踩过）。
  createProviderStreamer: () => ({
    ok: true,
    streamModel: () => (async function* () {})() ,
  }),
}));
vi.mock("@/lib/ai/resume-source", () => ({
  // 漏了这个 mock 会得到 undefined → 路由返回 404「找不到该简历」。
  loadResumeSourceForRun: async () => ({
    content: { basics: {}, experience: [], sectionOrder: [] },
    revision: 3,
    title: "简历",
    templateId: "classic",
  }),
}));
vi.mock("@/lib/ai/run-route-support", () => ({
  streamRunAttempt: (...args: unknown[]) => streamAttemptMock(...args),
}));

const MODEL_CONFIG = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  modelName: "gpt-test",
};

/** 合法的最小请求体。 */
function body(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    sessionId: null,
    resumeId: "resume-1",
    revision: 3,
    message: "再短一点",
    mode: "optimize_existing",
    writeMode: "direct",
    modelConfig: MODEL_CONFIG,
    ...overrides,
  };
}

async function callStart(payload: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ai/runs/route");
  return POST(
    new Request("http://localhost/api/ai/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1", name: "测试用户" } });
  startRunMock.mockResolvedValue({ status: "created", runId: "run-1" });
  acquireLeaseMock.mockResolvedValue({
    status: "acquired",
    fenceToken: 1,
  });
  streamAttemptMock.mockReturnValue(
    new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } }),
  );
});

describe("history 透传（多轮会话不失忆）", () => {
  it("**合法历史被原样传给编排层**", async () => {
    const history = [
      { role: "user", content: "帮我看看简历" },
      { role: "assistant", content: "我看到三个问题" },
    ];
    await callStart(body({ history }));

    expect(streamAttemptMock).toHaveBeenCalledTimes(1);
    const input = streamAttemptMock.mock.calls[0][0] as { history: unknown[] };
    // 这是「链路上真的带上了历史」的证据。
    expect(input.history).toEqual(history);
  });

  it("**不传 history 时为空数组**（不是 undefined）", async () => {
    await callStart(body());
    const input = streamAttemptMock.mock.calls[0][0] as { history: unknown[] };
    expect(input.history).toEqual([]);
  });

  it("**单轮多条的完整历史都被保留**（不只最后一条）", async () => {
    const history = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
    ];
    await callStart(body({ history, message: "u4" }));
    const input = streamAttemptMock.mock.calls[0][0] as { history: unknown[] };
    expect(input.history).toHaveLength(5);
    expect(input.history[0]).toEqual({ role: "user", content: "u1" });
  });
});

describe("非法历史被拒绝（不静默丢弃）", () => {
  it("history 不是数组 → 400", async () => {
    const response = await callStart(body({ history: "nope" }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe("invalid_history");
    // 拒绝时不建 Run、不执行。
    expect(startRunMock).not.toHaveBeenCalled();
    expect(streamAttemptMock).not.toHaveBeenCalled();
  });

  it("**role 非法 → 400**", async () => {
    const response = await callStart(body({ history: [{ role: "system", content: "x" }] }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe("invalid_history");
  });

  it("**content 不是字符串 → 400**", async () => {
    const response = await callStart(body({ history: [{ role: "user", content: 123 }] }));
    expect(response.status).toBe(400);
  });

  it("条目不是对象 → 400", async () => {
    const response = await callStart(body({ history: ["nope"] }));
    expect(response.status).toBe(400);
  });

  it("引用了不存在的 role 值 → 400（白名单而非黑名单）", async () => {
    const response = await callStart(body({ history: [{ role: "tool", content: "x" }] }));
    expect(response.status).toBe(400);
  });

  it("混入一条非法条目 → 整个请求被拒（不部分接受）", async () => {
    const response = await callStart(
      body({
        history: [
          { role: "user", content: "合法" },
          { role: "assistant", content: null },
        ],
      }),
    );
    expect(response.status).toBe(400);
    expect(streamAttemptMock).not.toHaveBeenCalled();
  });
});

describe("长度上限仍然生效", () => {
  it("**超过历史条数上限 → 400**（校验没被绕过）", async () => {
    // 上限是 100 条（AI_REQUEST_LIMITS.maxHistoryMessages）。
    const history = Array.from({ length: 200 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `m${index}`,
    }));
    const response = await callStart(body({ history }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe("history_too_long");
    expect(streamAttemptMock).not.toHaveBeenCalled();
  });

  it("恰好在上限内可通过", async () => {
    const history = Array.from({ length: 100 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `m${index}`,
    }));
    const response = await callStart(body({ history }));
    expect(response.status).toBe(200);
    expect(streamAttemptMock).toHaveBeenCalledTimes(1);
  });
});
