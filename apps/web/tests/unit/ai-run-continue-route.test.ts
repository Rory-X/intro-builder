import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `POST /api/ai/runs/[runId]/continue` 的行为契约（P04 任务 6）。
 *
 * 「继续」比「启动」多三类危险，因为它是**在已有 Run 上再跑一次**：
 *
 * 1. **接管仍然有效的租约**。另一个请求正在跑时若被接管，同一个 Run 会出现
 *    两个 attempt 并发写同一份文档 —— 两份事件交错、sequence 混乱。
 *    必须拒绝（409），而不是「尽力而为」。
 * 2. **对终态 Run 继续**。已完成的 Run 继续执行会让「终态只出现一次」失效。
 * 3. **归属不校验**。别人的 Run 不能继续，且不能泄露它是否存在（404 而非 403）。
 */

const authMock = vi.fn();
const getRunMock = vi.fn();
const acquireLeaseMock = vi.fn();
const loadResumeSourceMock = vi.fn();
const createProviderStreamerMock = vi.fn();
const streamRunAttemptMock = vi.fn();
const readAttemptEndTypeMock = vi.fn();
const listEventsMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/ai/run-store", () => ({
  getRun: (...a: unknown[]) => getRunMock(...a),
  acquireLease: (...a: unknown[]) => acquireLeaseMock(...a),
  readAttemptEndType: (...a: unknown[]) => readAttemptEndTypeMock(...a),
  listEvents: (...a: unknown[]) => listEventsMock(...a),
  reconcileMutationEvents: async () => 0,
}));
vi.mock("@/lib/ai/resume-source", () => ({
  loadResumeSourceForRun: (...a: unknown[]) => loadResumeSourceMock(...a),
}));
vi.mock("@/lib/ai/provider", () => ({
  createProviderStreamer: (...a: unknown[]) => createProviderStreamerMock(...a),
}));
vi.mock("@/lib/ai/run-route-support", () => ({
  streamRunAttempt: (...a: unknown[]) => streamRunAttemptMock(...a),
}));

const VISIBLE_UNTIL = new Date(Date.now() + 60_000);

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    userId: "user-1",
    resumeId: "resume-1",
    sessionId: "sess-1",
    status: "waiting_user",
    mode: "optimize_existing",
    writeMode: "direct",
    fenceToken: 4,
    leaseOwner: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    checkpointVersion: 1,
    checkpoint: { pendingQuestion: { questionId: "q-1", question: "量化结果？" } },
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-2",
    checkpointVersion: 1,
    message: "提升了 30%",
    modelConfig: { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", modelName: "m" },
    ...overrides,
  };
}

async function callRoute(payload: unknown, runId = "run-1") {
  const { POST } = await import("@/app/api/ai/runs/[runId]/continue/route");
  return POST(
    new Request(`http://localhost/api/ai/runs/${runId}/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ runId }) },
  );
}

describe("POST /api/ai/runs/[runId]/continue", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset().mockResolvedValue({ user: { id: "user-1", name: "林可" } });
    getRunMock.mockReset().mockResolvedValue(run());
    acquireLeaseMock.mockReset().mockResolvedValue({
      status: "acquired",
      fenceToken: 5,
      leaseExpiresAt: VISIBLE_UNTIL,
    });
    loadResumeSourceMock.mockReset().mockResolvedValue({
      content: { experience: [], projects: [], education: [], research: [], custom: [], sectionOrder: [] },
      revision: 7,
      title: "简历",
      templateId: "classic",
    });
    createProviderStreamerMock.mockReset().mockReturnValue({
      ok: true,
      streamModel: () => (async function* () {})(),
    });
    streamRunAttemptMock.mockReset().mockReturnValue(
      new Response("", { headers: { "Content-Type": "text/event-stream" } }),
    );
    readAttemptEndTypeMock.mockReset().mockResolvedValue("run.waiting_user");
    listEventsMock.mockReset().mockResolvedValue([]);
  });

  it("未登录返回 401，且不读取 Run", async () => {
    authMock.mockResolvedValue(null);
    const response = await callRoute(body());
    expect(response.status).toBe(401);
    expect(getRunMock).not.toHaveBeenCalled();
  });

  it("Run 不存在返回 404", async () => {
    getRunMock.mockResolvedValue(null);
    const response = await callRoute(body());
    expect(response.status).toBe(404);
    expect(acquireLeaseMock).not.toHaveBeenCalled();
  });

  it("别人的 Run 返回 404（不泄露存在性）", async () => {
    getRunMock.mockResolvedValue(run({ userId: "someone-else" }));
    const response = await callRoute(body());
    expect(response.status).toBe(404);
    expect(streamRunAttemptMock).not.toHaveBeenCalled();
  });

  it("终态 Run 返回 409（终态只出现一次，不可复活）", async () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      getRunMock.mockResolvedValue(run({ status }));
      const response = await callRoute(body());
      expect(response.status, `status=${status}`).toBe(409);
    }
    expect(streamRunAttemptMock).not.toHaveBeenCalled();
  });

  it("缺少 checkpointVersion 返回 400（避免基于过期检查点继续）", async () => {
    const response = await callRoute(body({ checkpointVersion: undefined }));
    expect(response.status).toBe(400);
    expect(streamRunAttemptMock).not.toHaveBeenCalled();
  });

  it("checkpointVersion 与库中不符返回 409，且不申请租约", async () => {
    getRunMock.mockResolvedValue(run({ checkpointVersion: 3 }));
    const response = await callRoute(body({ checkpointVersion: 1 }));
    expect(response.status).toBe(409);
    const json = (await response.json()) as { code?: string };
    expect(json.code).toBe("stale_checkpoint");
    // 关键：版本不符时必须在**申请租约之前**拦下，否则会白占租约。
    expect(acquireLeaseMock).not.toHaveBeenCalled();
  });

  it("仍有有效租约时返回 409（不接管，避免两个 attempt 并发写）", async () => {
    acquireLeaseMock.mockResolvedValue({ status: "held_by_other" });
    const response = await callRoute(body());
    expect(response.status).toBe(409);
    const json = (await response.json()) as { code?: string };
    expect(json.code).toBe("held_by_other");
    expect(streamRunAttemptMock).not.toHaveBeenCalled();
  });

  it("provider 配置非法返回 400，且不申请租约", async () => {
    createProviderStreamerMock.mockReturnValue({
      ok: false,
      code: "private_network",
      message: "不允许使用内网地址",
    });
    const response = await callRoute(body());
    expect(response.status).toBe(400);
    expect(acquireLeaseMock).not.toHaveBeenCalled();
    expect(streamRunAttemptMock).not.toHaveBeenCalled();
  });

  it("消息为空返回 400", async () => {
    const response = await callRoute(body({ message: "   " }));
    expect(response.status).toBe(400);
    expect(streamRunAttemptMock).not.toHaveBeenCalled();
  });

  it("请求体不是合法 JSON 返回 400", async () => {
    const { POST } = await import("@/app/api/ai/runs/[runId]/continue/route");
    const response = await POST(
      new Request("http://localhost/api/ai/runs/run-1/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );
    expect(response.status).toBe(400);
  });

  it("成功时以**新 fenceToken** 执行，并把授权模式取自已落库的 Run", async () => {
    getRunMock.mockResolvedValue(run({ writeMode: "approval", status: "waiting_user" }));
    await callRoute(body());

    expect(streamRunAttemptMock).toHaveBeenCalledTimes(1);
    const args = streamRunAttemptMock.mock.calls[0][0] as Record<string, unknown>;
    // 新租约的 fenceToken（5），不是库里的旧值（4）。
    expect(args.fenceToken).toBe(5);
    // 授权模式不能由请求体自选。
    expect(args.writeMode).toBe("approval");
    expect(args.runId).toBe("run-1");
    expect(args.message).toBe("提升了 30%");
  });

  it("成功时返回 SSE 流", async () => {
    const response = await callRoute(body());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("interrupted 的 Run 可以继续（平台硬杀后能恢复）", async () => {
    getRunMock.mockResolvedValue(run({ status: "interrupted" }));
    const response = await callRoute(body());
    expect(response.status).toBe(200);
    expect(streamRunAttemptMock).toHaveBeenCalled();
  });

  it("running 但租约已过期的 Run 可以接管", async () => {
    // 库里的租约已过期，acquireLease 会成功（SQL 条件允许）。
    getRunMock.mockResolvedValue(
      run({ status: "running", leaseOwner: "dead-owner", leaseExpiresAt: new Date(Date.now() - 1000) }),
    );
    const response = await callRoute(body());
    expect(response.status).toBe(200);
  });
});
