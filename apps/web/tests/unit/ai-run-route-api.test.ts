import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Run 路由的**行为契约**测试（P04 任务 6）。
 *
 * 重点验证三类「看起来能用但其实危险」的失败：
 * 1. 查询进度时**启动模型**（刷新页面 = 又跑一次）；
 * 2. 越权读取他人 Run 时泄露存在性（403 vs 404）；
 * 3. 取消已终态的任务却报告「已取消」。
 */

const authMock = vi.fn();
const getRunMock = vi.fn();
const listEventsMock = vi.fn();
const requestCancelMock = vi.fn();
const appendEventMock = vi.fn();
const isRunWritableMock = vi.fn();
const reconcileMock = vi.fn();
const listToolExecutionsMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/ai/run-store", () => ({
  getRun: (...args: unknown[]) => getRunMock(...args),
  listEvents: (...args: unknown[]) => listEventsMock(...args),
  requestCancel: (...args: unknown[]) => requestCancelMock(...args),
  appendEvent: (...args: unknown[]) => appendEventMock(...args),
  isRunWritable: (...args: unknown[]) => isRunWritableMock(...args),
  reconcileMutationEvents: (...args: unknown[]) => reconcileMock(...args),
  listToolExecutions: (...args: unknown[]) => listToolExecutionsMock(...args),
}));

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    userId: "user-1",
    resumeId: "resume-1",
    sessionId: null,
    requestId: "req-1",
    status: "running",
    mode: "optimize_existing",
    writeMode: "direct",
    leaseOwner: "w1",
    leaseExpiresAt: new Date(Date.now() + 30_000),
    fenceToken: 3,
    cancelRequestedAt: null,
    deadlineAt: null,
    startedAt: new Date("2026-09-26T10:00:00Z"),
    finishedAt: null,
    checkpointVersion: 0,
    checkpoint: null,
    promptVersion: "v1",
    modelId: "test-model",
    usage: null,
    parentRunId: null,
    lastError: null,
    ...overrides,
  };
}

async function callGet(runId = "run-1", query = "") {
  const { GET } = await import("@/app/api/ai/runs/[runId]/route");
  return GET(new Request(`http://localhost/api/ai/runs/${runId}${query}`), {
    params: Promise.resolve({ runId }),
  });
}

async function callPost(runId = "run-1", body: unknown = { action: "cancel" }) {
  const { POST } = await import("@/app/api/ai/runs/[runId]/route");
  return POST(
    new Request(`http://localhost/api/ai/runs/${runId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ runId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  getRunMock.mockResolvedValue(runRow());
  listEventsMock.mockResolvedValue([]);
  reconcileMock.mockResolvedValue(0);
  appendEventMock.mockResolvedValue({});
  requestCancelMock.mockResolvedValue({ runStatus: "running" });
  isRunWritableMock.mockResolvedValue(false);
});

describe("GET：查询不启动模型", () => {
  it("返回脱敏状态快照（不含 checkpoint 正文）", async () => {
    const response = await callGet();
    const body = (await response.json()) as { run: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(body.run.runId).toBe("run-1");
    expect(body.run.status).toBe("running");
    expect(body.run.isTerminal).toBe(false);
    // 不得把整份 checkpoint 返回（可能含模型消息）。
    expect(body.run).not.toHaveProperty("checkpoint");
    expect(body.run).not.toHaveProperty("leaseOwner");
  });

  it("不调用任何启动执行的接口（刷新页面不等于又跑一次）", async () => {
    await callGet();
    // 运行存储里没有任何「启动」被触发：只读了状态。
    expect(requestCancelMock).not.toHaveBeenCalled();
    expect(appendEventMock).not.toHaveBeenCalled();
  });

  it("未登录返回 401", async () => {
    authMock.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(401);
  });

  it("他人 Run 返回 404（不泄露存在性）", async () => {
    getRunMock.mockResolvedValue(runRow({ userId: "other-user" }));
    const response = await callGet();
    expect(response.status).toBe(404);
  });

  it("不存在的 Run 返回 404", async () => {
    getRunMock.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(404);
  });
});

describe("GET events：先补齐投影再读", () => {
  it("读取事件前协调遗漏的提交投影", async () => {
    await callGet("run-1", "?events=1&after=0");
    // 关键顺序：不先协调，UI 可能永远看不到已提交的事件而显示「未保存」。
    expect(reconcileMock).toHaveBeenCalledWith("run-1", "reconcile", expect.any(Function));
    expect(listEventsMock).toHaveBeenCalled();
  });

  it("返回续读游标（按 sequence 分页）", async () => {
    listEventsMock.mockResolvedValue([
      { schemaVersion: 1, eventId: "e1", runId: "run-1", attemptId: "a", sequence: 1, type: "text.delta", occurredAt: "", payload: {} },
      { schemaVersion: 1, eventId: "e2", runId: "run-1", attemptId: "a", sequence: 2, type: "text.delta", occurredAt: "", payload: {} },
    ]);
    const response = await callGet("run-1", "?events=1&after=0");
    const body = (await response.json()) as { lastSequence: number; events: unknown[] };
    expect(body.lastSequence).toBe(2);
    expect(body.events).toHaveLength(2);
  });

  it("没有新事件时游标停在原处（不倒退）", async () => {
    listEventsMock.mockResolvedValue([]);
    const response = await callGet("run-1", "?events=1&after=7");
    const body = (await response.json()) as { lastSequence: number };
    expect(body.lastSequence).toBe(7);
  });
});

describe("【复核发现】非法查询参数返回 400 而不是 500", () => {
  it("after 非整数 → 400", async () => {
    const response = await callGet("run-1", "?events=1&after=abc");
    expect(response.status).toBe(400);
  });

  it("after 为负数 → 400", async () => {
    const response = await callGet("run-1", "?events=1&after=-1");
    expect(response.status).toBe(400);
  });

  it("limit 越界或非整数 → 400", async () => {
    for (const query of ["?events=1&limit=-5", "?events=1&limit=0", "?events=1&limit=99999", "?events=1&limit=abc"]) {
      const response = await callGet("run-1", query);
      expect(response.status, query).toBe(400);
    }
  });

  it("合法参数正常返回", async () => {
    const response = await callGet("run-1", "?events=1&after=0&limit=50");
    expect(response.status).toBe(200);
  });
});

describe("POST cancel：幂等且不谎报", () => {
  it("取消成功时落库并报告 writable=false", async () => {
    const response = await callPost();
    const body = (await response.json()) as { cancelled: boolean; writable: boolean };
    expect(body.cancelled).toBe(true);
    // writable=false 让调用方知道此后提交会被 fencing 拦下。
    expect(body.writable).toBe(false);
    expect(requestCancelMock).toHaveBeenCalledWith("run-1");
  });

  it("取消会记录事件（可被 UI 观察到）", async () => {
    await callPost();
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", type: "run.cancelled" }),
    );
  });

  it("已终态的任务取消不谎报成功", async () => {
    getRunMock.mockResolvedValue(runRow({ status: "completed" }));
    const response = await callPost();
    const body = (await response.json()) as { cancelled: boolean; reason: string };
    expect(body.cancelled).toBe(false);
    expect(body.reason).toContain("已结束");
    // 不应再写取消意图。
    expect(requestCancelMock).not.toHaveBeenCalled();
  });

  it("取消幂等：重复调用返回同样结果（不覆盖首次时间）", async () => {
    const first = await callPost();
    const second = await callPost();
    expect((await first.json()).cancelled).toBe(true);
    expect((await second.json()).cancelled).toBe(true);
  });

  it("不支持的动作被拒绝", async () => {
    const response = await callPost("run-1", { action: "execute" });
    expect(response.status).toBe(400);
  });

  it("空请求体按默认动作（取消）处理，不信任其中的身份字段", async () => {
    const response = await callPost("run-1", { userId: "someone-else" });
    // 归属仍按会话判断：body 里的 userId 被忽略。
    expect(getRunMock).toHaveBeenCalledWith("run-1");
    expect(response.status).toBe(200);
  });

  it("【复核发现】取消事件写失败不影响「取消已生效」的结论", async () => {
    /*
     * 事件写失败不能让整个请求 500：取消意图已经落库，而「取消已生效但事件没写」
     * 与「取消根本没生效」的后续行为完全不同。
     */
    appendEventMock.mockRejectedValue(new Error("事件写入失败"));
    const response = await callPost();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { cancelled: boolean; eventRecorded: boolean };
    expect(body.cancelled).toBe(true);
    expect(body.eventRecorded).toBe(false);
  });

  it("取消他人 Run 返回 404", async () => {
    getRunMock.mockResolvedValue(runRow({ userId: "other" }));
    const response = await callPost();
    expect(response.status).toBe(404);
    expect(requestCancelMock).not.toHaveBeenCalled();
  });
});

describe("PATCH：工具账本只读", () => {
  it("返回工具执行摘要（不含参数正文）", async () => {
    listToolExecutionsMock.mockResolvedValue([
      {
        attemptId: "a1", toolCallId: "c1", toolName: "addWorkExperience",
        inputHash: "h", status: "succeeded", result: { big: "payload" },
        mutationId: "m-1", changeSetId: null, errorCode: null,
      },
    ]);
    const { PATCH } = await import("@/app/api/ai/runs/[runId]/route");
    const response = await PATCH(new Request("http://localhost/api/ai/runs/run-1"), {
      params: Promise.resolve({ runId: "run-1" }),
    });
    const body = (await response.json()) as { tools: Array<Record<string, unknown>> };
    expect(body.tools[0].toolName).toBe("addWorkExperience");
    expect(body.tools[0].mutationId).toBe("m-1");
    // 结果正文不回传（可能很大，也可能含敏感内容）。
    expect(body.tools[0]).not.toHaveProperty("result");
  });
});
