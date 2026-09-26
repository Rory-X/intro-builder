import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `POST /api/ai/runs` 的行为契约（P04 任务 2 + 6）。
 *
 * 这是新链路的入口，因此最容易出的错都是「看起来成功了」：
 *
 * 1. **重复请求二次调用模型**。客户端超时重试、用户连点两下，都会发同一个
 *    `requestId`。必须复用已有 Run，而不是再烧一次额度、让两个 Run 抢同一份简历。
 * 2. **配置非法却仍发起请求**。BYOK 的 URL 是用户可控输入，校验不通过就不该
 *    构造 provider，更不该开始执行。
 * 3. **拿不到租约却照样执行**。同一简历同时只允许一个写 Run；拿不到租约时应
 *    明确拒绝（409），而不是两个 Run 并行写同一份文档。
 * 4. **归属不校验**。resumeId 来自请求体，必须确认它属于当前用户。
 */

const authMock = vi.fn();
const startRunMock = vi.fn();
const acquireLeaseMock = vi.fn();
const releaseLeaseMock = vi.fn();
const renewLeaseMock = vi.fn();
const finishRunMock = vi.fn();
const appendEventMock = vi.fn();
const isRunWritableMock = vi.fn();
const getRunMock = vi.fn();
const reconcileMock = vi.fn();
const startToolExecutionMock = vi.fn();
const finishToolExecutionMock = vi.fn();
const createProviderStreamerMock = vi.fn();
const executeToolCallMock = vi.fn();
const loadResumeSourceMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/ai/run-store", () => ({
  startRun: (...a: unknown[]) => startRunMock(...a),
  acquireLease: (...a: unknown[]) => acquireLeaseMock(...a),
  releaseLease: (...a: unknown[]) => releaseLeaseMock(...a),
  renewLease: (...a: unknown[]) => renewLeaseMock(...a),
  finishRun: (...a: unknown[]) => finishRunMock(...a),
  appendEvent: (...a: unknown[]) => appendEventMock(...a),
  isRunWritable: (...a: unknown[]) => isRunWritableMock(...a),
  getRun: (...a: unknown[]) => getRunMock(...a),
  reconcileMutationEvents: (...a: unknown[]) => reconcileMock(...a),
  startToolExecution: (...a: unknown[]) => startToolExecutionMock(...a),
  finishToolExecution: (...a: unknown[]) => finishToolExecutionMock(...a),
  toolInputHash: () => "hash",
}));
vi.mock("@/lib/ai/provider", () => ({
  createProviderStreamer: (...a: unknown[]) => createProviderStreamerMock(...a),
}));
vi.mock("@/lib/ai/tools/execute", () => ({
  executeToolCall: (...a: unknown[]) => executeToolCallMock(...a),
  availableToolNames: () => ["readResume"],
}));
vi.mock("@/lib/ai/resume-source", () => ({
  loadResumeSourceForRun: (...a: unknown[]) => loadResumeSourceMock(...a),
}));

const VALID_BODY = {
  requestId: "req-1",
  sessionId: "sess-1",
  resumeId: "resume-1",
  revision: 7,
  message: "帮我把项目描述写具体一点",
  mode: "optimize_existing",
  modelConfig: { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", modelName: "m" },
};

async function callRoute(body: unknown) {
  const { POST } = await import("@/app/api/ai/runs/route");
  return POST(
    new Request("http://localhost/api/ai/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/ai/runs", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset().mockResolvedValue({ user: { id: "user-1", name: "林可" } });
    startRunMock.mockReset().mockResolvedValue({ status: "created", runId: "run-1" });
    acquireLeaseMock.mockReset().mockResolvedValue({
      status: "acquired",
      fenceToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    releaseLeaseMock.mockReset().mockResolvedValue(undefined);
    renewLeaseMock.mockReset().mockResolvedValue(undefined);
    finishRunMock.mockReset().mockResolvedValue({ status: "updated", runStatus: "completed" });
    appendEventMock.mockReset().mockResolvedValue({});
    isRunWritableMock.mockReset().mockResolvedValue(true);
    getRunMock.mockReset();
    reconcileMock.mockReset().mockResolvedValue(0);
    startToolExecutionMock.mockReset().mockResolvedValue(true);
    finishToolExecutionMock.mockReset().mockResolvedValue(undefined);
    createProviderStreamerMock.mockReset().mockReturnValue({
      ok: true,
      streamModel: () => (async function* () {})(),
    });
    executeToolCallMock.mockReset();
    loadResumeSourceMock.mockReset().mockResolvedValue({
      content: { basics: {}, experience: [], projects: [], education: [], research: [], custom: [], sectionOrder: [] },
      revision: 7,
      title: "简历",
      templateId: "classic",
    });
  });

  it("未登录返回 401，且不创建 Run", async () => {
    authMock.mockResolvedValue(null);
    const response = await callRoute(VALID_BODY);
    expect(response.status).toBe(401);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("缺 requestId 返回 400，且不创建 Run", async () => {
    const response = await callRoute({ ...VALID_BODY, requestId: undefined });
    expect(response.status).toBe(400);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("请求体不是合法 JSON 返回 400", async () => {
    const { POST } = await import("@/app/api/ai/runs/route");
    const response = await POST(
      new Request("http://localhost/api/ai/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("消息超长返回 400，且不创建 Run", async () => {
    const response = await callRoute({ ...VALID_BODY, message: "x".repeat(20_001) });
    expect(response.status).toBe(400);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("模型配置非法返回 400，且**不创建 Run**、不开始执行", async () => {
    createProviderStreamerMock.mockReturnValue({
      ok: false,
      code: "private_network",
      message: "不允许使用内网地址",
    });

    const response = await callRoute(VALID_BODY);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { code?: string };
    expect(json.code).toBe("private_network");
    /*
     * 关键：配置错误必须在**创建 Run 之前**拦下。
     * 否则库里会留下一个永远不会被执行的 Run，而它的租约还会挡住后续请求。
     */
    expect(startRunMock).not.toHaveBeenCalled();
    expect(acquireLeaseMock).not.toHaveBeenCalled();
  });

  it("简历不属于当前用户时返回 404，且不创建 Run", async () => {
    loadResumeSourceMock.mockResolvedValue(null);
    const response = await callRoute(VALID_BODY);
    expect(response.status).toBe(404);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("revision 不是整数返回 400", async () => {
    for (const bad of [1.5, "7", null, NaN]) {
      const response = await callRoute({ ...VALID_BODY, revision: bad });
      expect(response.status).toBe(400);
    }
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("重复 requestId 复用已有 Run，**不**二次调用模型", async () => {
    startRunMock.mockResolvedValue({ status: "existing", runId: "run-old", runStatus: "running" });

    const response = await callRoute(VALID_BODY);
    // 复用已有 Run：返回 200 且带上同一个 runId，而不是重新执行。
    expect(response.status).toBe(200);
    const json = (await response.json()) as { runId: string; reused: boolean };
    expect(json.runId).toBe("run-old");
    expect(json.reused).toBe(true);
    // 绝不能再申请租约、再跑一次模型。
    expect(acquireLeaseMock).not.toHaveBeenCalled();
  });

  it("拿不到租约返回 409，且不开始执行", async () => {
    acquireLeaseMock.mockResolvedValue({ status: "held_by_other" });
    const response = await callRoute(VALID_BODY);
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error?: string };
    expect(json.error).toBeTruthy();
  });

  it("Run 已是终态时返回 409（不可复活）", async () => {
    acquireLeaseMock.mockResolvedValue({ status: "terminal" });
    const response = await callRoute(VALID_BODY);
    expect(response.status).toBe(409);
  });

  it("成功时返回 SSE 流，且 Content-Type 正确", async () => {
    const response = await callRoute(VALID_BODY);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
  });

  it("成功时释放租约（无论流是否正常结束）", async () => {
    const response = await callRoute(VALID_BODY);
    // 消费整个流，等待收尾。
    await response.text();
    expect(releaseLeaseMock).toHaveBeenCalled();
  });

  it("执行完把 Run 写入终态（不留永久 running 的孤儿）", async () => {
    const response = await callRoute(VALID_BODY);
    await response.text();
    expect(finishRunMock).toHaveBeenCalled();
    const statuses = finishRunMock.mock.calls.map((c) => (c[0] as { status: string }).status);
    // 空流（没有 finish 片段）= 被截断 → interrupted，绝不报 completed。
    expect(statuses).toContain("interrupted");
  });

  it("空流不被判成 completed（没有 finish 片段的 EOF 是 interrupted）", async () => {
    const response = await callRoute(VALID_BODY);
    const text = await response.text();
    // 事件里应当出现 interrupted 而非 completed。
    expect(text).not.toContain('"run.completed"');
  });

  it("writeMode 只接受 direct / approval，其它值收敛为 direct", async () => {
    await callRoute({ ...VALID_BODY, writeMode: "god-mode" });
    const args = startRunMock.mock.calls[0][0] as { writeMode: string };
    expect(args.writeMode).toBe("direct");
  });

  it("mode 由服务端白名单收敛，不信任请求体任意字符串", async () => {
    await callRoute({ ...VALID_BODY, mode: "../../etc/passwd" });
    const args = startRunMock.mock.calls[0][0] as { mode: string };
    expect(args.mode).toBe("optimize_existing");
  });
});

/**
 * 回归防线：锁住两条「复发会静默出错」的约束。
 */
describe("SDK 工具集与状态映射的硬约束", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  });

  it("交给 SDK 的每个工具都**没有** execute（否则会被 SDK 与编排层双重执行）", async () => {
    const mod = await import("@/lib/ai/run-route-support");
    const tools = mod.buildSdkTools();
    const names = Object.keys(tools);
    expect(names.length).toBeGreaterThan(0);

    /*
     * AI SDK 的 streamText 会自己执行带 execute 的工具
     * （SDK 内部：`if (tool.execute == null) return undefined;` 之后
     * `Promise.all(... tool.execute(...))`）。若这里提供了 execute，
     * 同一次工具调用会被执行两遍 —— 编排层一遍、SDK 一遍 ——
     * 产生两份提案、两套事件，其中一套完全绕过 fencing 与事件落库。
     */
    for (const name of names) {
      const tool = tools[name] as Record<string, unknown>;
      expect(tool.execute, `${name} 不应该有 execute`).toBeUndefined();
    }
  });

  it("每个注册工具都带 description 与 inputSchema（模型据此知道工具形状）", async () => {
    const mod = await import("@/lib/ai/run-route-support");
    const tools = mod.buildSdkTools();
    for (const [name, tool] of Object.entries(tools)) {
      const t = tool as Record<string, unknown>;
      expect(typeof t.description, `${name} 缺少 description`).toBe("string");
      expect(t.inputSchema, `${name} 缺少 inputSchema`).toBeDefined();
    }
  });

  it("结束类型映射：EOF 无结束事件判 interrupted，绝不判 completed", async () => {
    const mod = await import("@/lib/ai/run-route-support");
    const map = mod.runStatusForEndType;

    expect(map("run.completed")).toBe("completed");
    expect(map("run.failed")).toBe("failed");
    expect(map("run.cancelled")).toBe("cancelled");
    // 等待用户不是终态：用户可以继续。
    expect(map("run.waiting_user")).toBe("waiting_user");
    // 被截断必须如实报中断，不能报完成。
    expect(map("run.interrupted")).toBe("interrupted");
  });
});
