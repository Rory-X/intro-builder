import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 灰度开关在**路由层**是否真的生效（P04 任务 8）。
 *
 * 开关本身的行为由 `ai-run-route-flag.test.ts` 穷举。这里要证明的是另一件事：
 * 路由**真的调用了它**。
 *
 * 这类「开关接好了但没生效」的缺陷很隐蔽：开关模块自己有测试、路由测试也全绿
 * （因为测试环境恒开），但生产上新路由仍然可达。因此这里把开关 mock 成关闭，
 * 断言两条路由都返回 503 且**不产生任何副作用**（不读会话、不建 Run）。
 */

const authMock = vi.fn();
const startRunMock = vi.fn();
const acquireLeaseMock = vi.fn();
const getRunMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/ai/run-route-flag", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/run-route-flag")>(
    "@/lib/ai/run-route-flag",
  );
  return {
    ...actual,
    resolveRunRouteDecision: () => ({ mode: "legacy", reason: "开关未设置（测试）" }),
  };
});
vi.mock("@/lib/ai/run-store", () => ({
  getRun: (...a: unknown[]) => getRunMock(...a),
  startRun: (...a: unknown[]) => startRunMock(...a),
  acquireLease: (...a: unknown[]) => acquireLeaseMock(...a),
  listEvents: async () => [],
}));

async function callStart() {
  const { POST } = await import("@/app/api/ai/runs/route");
  return POST(
    new Request("http://localhost/api/ai/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "r1" }),
    }),
  );
}

async function callContinue() {
  const { POST } = await import("@/app/api/ai/runs/[runId]/continue/route");
  return POST(
    new Request("http://localhost/api/ai/runs/run-1/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "r1", checkpointVersion: 0, message: "x" }),
    }),
    // 动态路由必须传 context：Next.js 用第二个参数传 params。
    { params: Promise.resolve({ runId: "run-1" }) },
  );
}

describe("开关关闭时路由不可用", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    startRunMock.mockReset();
    acquireLeaseMock.mockReset();
    getRunMock.mockReset();
  });

  it("启动路由返回 503，且不读取会话、不创建 Run", async () => {
    const response = await callStart();
    expect(response.status).toBe(503);
    const json = (await response.json()) as { code?: string; mode?: string; reason?: string };
    expect(json.code).toBe("run_route_disabled");
    expect(json.mode).toBe("legacy");
    // 理由要带出来，否则运维无法判断是「没开」还是「配错了」。
    expect(json.reason).toBeTruthy();

    // 关键：开关判定必须在鉴权与建 Run **之前** —— 关闭时不应有任何副作用。
    expect(authMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("continue 路由也返回 503（只关启动等于开关形同虚设）", async () => {
    const response = await callContinue();
    expect(response.status).toBe(503);
    expect(authMock).not.toHaveBeenCalled();
    // 关闭时连 Run 都不该读 —— 否则越权者可借错误差异探测 Run 是否存在。
    expect(getRunMock).not.toHaveBeenCalled();
    expect(acquireLeaseMock).not.toHaveBeenCalled();
  });
});
