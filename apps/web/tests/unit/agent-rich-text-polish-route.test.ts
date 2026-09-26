import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

/**
 * `POST /api/agent/rich-text/polish` 的行为契约（P05 任务 4）。
 *
 * 这个路由已从「HTTP 转发到 Agent 微服务」改为「Web 侧直连模型」，
 * 因此测试重点随之变化：
 *
 * 1. **归属与鉴权不变**：未登录 401、简历不属于当前用户 404。
 * 2. **不再依赖微服务**：旧实现会 `signAgentToken` + `createAgentClient`。
 *    这里显式断言两者**不被调用** —— 若哪天有人把转发加回来，这条测试会失败，
 *    而「预览环境不配置 Agent URL 仍可用」正是本切片要达成的目标。
 * 3. **模型配置缺失时明确报错**：返回 `model_not_configured`，
 *    不回退已退役的服务。
 * 4. **失败按来源分流**：上游问题（模型返回不符约定 / 调用失败）报 502，
 *    不与用户参数错误混为一谈 —— 否则排查方向会被误导。
 */

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/token", () => ({ signAgentToken: vi.fn() }));
vi.mock("@/lib/agent/client", () => ({
  AgentClientError: class AgentClientError extends Error {},
  createAgentClient: vi.fn(),
}));
vi.mock("@/lib/ai/capabilities/polish-runner", () => ({ runPolish: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    query: {
      resumes: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import { currentUserId } from "@/lib/auth-helpers";
import { signAgentToken } from "@/lib/agent/token";
import { createAgentClient } from "@/lib/agent/client";
import { runPolish } from "@/lib/ai/capabilities/polish-runner";
import { db } from "@/db";
import { POST } from "@/app/api/agent/rich-text/polish/route";

const VALID_BODY = {
  resumeId: "resume-1",
  section: "summary",
  fieldPath: "summary",
  locale: "zh-CN",
  content: { format: "plain_text", plainText: "负责接口优化。" },
  intent: { mode: "polish", tone: "professional", length: "same", strategy: "plain" },
  modelConfig: { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", modelName: "m" },
};

function post(body: unknown = VALID_BODY) {
  return POST(
    new Request("http://localhost/api/agent/rich-text/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/agent/rich-text/polish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (currentUserId as Mock).mockResolvedValue("user-1");
    (db.query.resumes.findFirst as Mock).mockResolvedValue({ id: "resume-1" });
    (runPolish as Mock).mockResolvedValue({
      ok: true,
      result: { format: "plain_text", polishedText: "润色后", changeSummary: "更顺", riskFlags: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("未登录返回 401，且不读取简历", async () => {
    (currentUserId as Mock).mockResolvedValue(null);
    const response = await post();
    expect(response.status).toBe(401);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
  });

  it("简历不属于当前用户返回 404（不泄露存在性）", async () => {
    (db.query.resumes.findFirst as Mock).mockResolvedValue(undefined);
    const response = await post();
    expect(response.status).toBe(404);
    expect(runPolish).not.toHaveBeenCalled();
  });

  it("请求体不是合法 JSON 返回 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent/rich-text/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("缺 resumeId 返回 400，且不查库", async () => {
    const response = await post({ ...VALID_BODY, resumeId: undefined });
    expect(response.status).toBe(400);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
  });

  it("归属校验带 where 条件（越权防护的实际落点）", async () => {
    await post();
    const call = (db.query.resumes.findFirst as Mock).mock.calls[0][0] as { where?: unknown };
    expect(call.where).toBeDefined();
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
      result: { polishedText: string };
      usage: { inputTokens: number };
    };
    expect(body.status).toBe("ok");
    expect(body.result.polishedText).toBe("润色后");
    expect(body.usage.inputTokens).toBe(10);
  });

  it("把请求体与模型配置一起交给 runner", async () => {
    await post();
    const [bodyArg, configArg] = (runPolish as Mock).mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect((bodyArg as { resumeId: string }).resumeId).toBe("resume-1");
    expect(configArg).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-x",
      modelName: "m",
    });
  });

  it("缺少模型配置返回 model_not_configured，**不**回退旧服务", async () => {
    const response = await post({ ...VALID_BODY, modelConfig: undefined });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("model_not_configured");
    expect(runPolish).not.toHaveBeenCalled();
    expect(createAgentClient).not.toHaveBeenCalled();
  });

  it("模型配置不完整（缺 key）同样报 model_not_configured", async () => {
    const response = await post({
      ...VALID_BODY,
      modelConfig: { baseUrl: "https://api.example.com/v1", modelName: "m" },
    });
    expect(response.status).toBe(400);
    expect(runPolish).not.toHaveBeenCalled();
  });

  it("上游返回不符约定 → 502（不伪装成用户的参数错误）", async () => {
    (runPolish as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      code: "provider_response_invalid",
      message: "模型返回的内容不符合约定（missing polishedText）",
    });
    const response = await post();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("provider_response_invalid");
  });

  it("上游调用失败 → 502", async () => {
    (runPolish as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      code: "provider_unavailable",
      message: "模型服务调用失败",
    });
    expect((await post()).status).toBe(502);
  });

  it("校验失败保持 4xx（那是用户的输入问题）", async () => {
    (runPolish as Mock).mockResolvedValue({
      ok: false,
      status: 413,
      code: "payload_too_large",
      message: "content.plainText must be at most 4000 characters",
    });
    expect((await post()).status).toBe(413);
  });

  it("错误响应带 code，便于前端区分「没配模型」与「模型出错」", async () => {
    (runPolish as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      code: "insecure_protocol",
      message: "模型服务地址必须使用 https",
    });
    const body = (await (await post()).json()) as { code?: string };
    expect(body.code).toBe("insecure_protocol");
  });
});
