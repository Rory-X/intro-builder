import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

/**
 * `POST /api/agent/resume/helpers/[helperId]` 的行为契约（P05 任务 4）。
 *
 * 这个路由同样从「HTTP 转发到 Agent 微服务」改为「Web 侧直连模型」，
 * 因此测试重点随之变化：
 *
 * 1. **鉴权与归属不变**，helperId 白名单不变。
 * 2. **不再依赖微服务**：旧实现会 `signAgentToken` + `createAgentClient`。
 *    这里显式断言两者**不被调用** —— 若有人把转发加回来，这条会失败，
 *    而「预览环境不配置 Agent URL 仍可用」正是本切片的目标。
 * 3. **模型配置缺失时报 `model_not_configured`，不回退旧服务**。
 * 4. **失败按来源分流**：上游问题 502，校验与地址策略 4xx。
 * 5. **建议超限如实回报 `truncated`**，不假装全部满足。
 */

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/token", () => ({ signAgentToken: vi.fn() }));
vi.mock("@/lib/agent/client", () => ({
  AgentClientError: class AgentClientError extends Error {},
  createAgentClient: vi.fn(),
}));
vi.mock("@/lib/ai/capabilities/resume-helper-runner", () => ({ runResumeHelper: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    query: {
      resumes: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import { db } from "@/db";
import { currentUserId } from "@/lib/auth-helpers";
import { signAgentToken } from "@/lib/agent/token";
import { createAgentClient } from "@/lib/agent/client";
import { runResumeHelper } from "@/lib/ai/capabilities/resume-helper-runner";
import { maxDuration, POST } from "@/app/api/agent/resume/helpers/[helperId]/route";

const VALID_BODY = {
  resumeId: "resume-1",
  locale: "zh-CN",
  target: { kind: "resume", section: null, fieldPath: null },
  context: {
    resumeTitle: "前端工程师",
    completeness: { overall: 62, sections: [] },
    sections: [{ key: "experience", label: "工作经历", plainText: "参与订单系统开发。" }],
  },
  intent: { mode: "diagnose", maxSuggestions: 3, strategy: "plain" },
  modelConfig: { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", modelName: "m" },
};

function post(helperId = "resume-diagnose", body: unknown = VALID_BODY) {
  return POST(
    new Request(`http://localhost/api/agent/resume/helpers/${helperId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ helperId }) },
  );
}

describe("POST /api/agent/resume/helpers/[helperId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (currentUserId as Mock).mockResolvedValue("user-1");
    (db.query.resumes.findFirst as Mock).mockResolvedValue({ id: "resume-1" });
    (runResumeHelper as Mock).mockResolvedValue({
      ok: true,
      result: { summary: "摘要", suggestions: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
      truncated: 0,
    });
  });

  it("允许长时生成（Vercel maxDuration）", () => {
    expect(maxDuration).toBe(120);
  });

  it("未登录返回 401，且不读取简历", async () => {
    (currentUserId as Mock).mockResolvedValue(null);
    const response = await post();
    expect(response.status).toBe(401);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
  });

  it("不支持的 helperId 返回 404，且不查库", async () => {
    const response = await post("no-such-helper");
    expect(response.status).toBe(404);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
  });

  it("简历不属于当前用户返回 404（不泄露存在性）", async () => {
    (db.query.resumes.findFirst as Mock).mockResolvedValue(undefined);
    const response = await post();
    expect(response.status).toBe(404);
    expect(runResumeHelper).not.toHaveBeenCalled();
  });

  it("请求体不是合法 JSON 返回 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent/resume/helpers/resume-diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      }),
      { params: Promise.resolve({ helperId: "resume-diagnose" }) },
    );
    expect(response.status).toBe(400);
  });

  it("缺 resumeId 返回 400，且不查库", async () => {
    const response = await post("resume-diagnose", { ...VALID_BODY, resumeId: undefined });
    expect(response.status).toBe(400);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
  });

  /*
   * 迁移的核心断言：不再依赖旧微服务。
   * 若有人把 HTTP 转发加回来，这两条会立刻失败。
   */
  it("**不再**签发 Agent token", async () => {
    await post();
    expect(signAgentToken).not.toHaveBeenCalled();
  });

  it("**不再**创建 Agent 客户端", async () => {
    await post();
    expect(createAgentClient).not.toHaveBeenCalled();
  });

  it("成功时返回与旧实现一致的响应形状（前端无需改动）", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      helperId: string;
      result: { summary: string };
      usage: { inputTokens: number };
    };
    expect(body.status).toBe("ok");
    expect(body.helperId).toBe("resume-diagnose");
    expect(body.result.summary).toBe("摘要");
    expect(body.usage.inputTokens).toBe(10);
  });

  it("把 helperId 与模型配置一起交给 runner", async () => {
    await post();
    const [bodyArg, helperIdArg, configArg] = (runResumeHelper as Mock).mock.calls[0] as [
      Record<string, unknown>,
      string,
      Record<string, unknown>,
    ];
    expect((bodyArg as { resumeId: string }).resumeId).toBe("resume-1");
    expect(helperIdArg).toBe("resume-diagnose");
    expect(configArg).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-x",
      modelName: "m",
    });
  });

  it("section-next-steps 把正确 helperId 透传给 runner", async () => {
    await post("section-next-steps", {
      ...VALID_BODY,
      target: { kind: "section", section: "experience", fieldPath: null },
      intent: { mode: "next_steps", maxSuggestions: 3, strategy: "star" },
    });
    const [, helperIdArg] = (runResumeHelper as Mock).mock.calls[0] as [unknown, string];
    expect(helperIdArg).toBe("section-next-steps");
  });

  it("缺少模型配置返回 model_not_configured，**不**回退旧服务", async () => {
    const response = await post("resume-diagnose", { ...VALID_BODY, modelConfig: undefined });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("model_not_configured");
    expect(runResumeHelper).not.toHaveBeenCalled();
    expect(createAgentClient).not.toHaveBeenCalled();
  });

  it("上游返回不符约定 → 502（不伪装成用户的参数错误）", async () => {
    (runResumeHelper as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      code: "provider_response_invalid",
      message: "模型返回的内容不符合约定（Provider response missing summary）",
    });
    const response = await post();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("provider_response_invalid");
  });

  it("上游调用失败 → 502", async () => {
    (runResumeHelper as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      code: "provider_unavailable",
      message: "模型服务调用失败",
    });
    expect((await post()).status).toBe(502);
  });

  it("校验失败保持 4xx（那是用户的输入问题）", async () => {
    (runResumeHelper as Mock).mockResolvedValue({
      ok: false,
      status: 413,
      code: "payload_too_large",
      message: "context plainText must be at most 12000 characters",
    });
    expect((await post()).status).toBe(413);
  });

  it("建议超限时如实回报 truncated（不假装全部满足）", async () => {
    (runResumeHelper as Mock).mockResolvedValue({
      ok: true,
      result: { summary: "s", suggestions: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
      truncated: 2,
    });
    const body = (await (await post()).json()) as { truncated?: number };
    expect(body.truncated).toBe(2);
  });

  it("未超限时不返回 truncated 字段（避免前端显示无意义的 0）", async () => {
    const body = (await (await post()).json()) as { truncated?: number };
    expect(body.truncated).toBeUndefined();
  });
});
