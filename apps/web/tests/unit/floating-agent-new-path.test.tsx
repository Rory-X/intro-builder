import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyResumeContent, ResumeContent } from "@intro-builder/shared/schemas";

import { FloatingAgentChat } from "@/components/agent/floating-agent-chat";
import { CLIENT_RUN_PATH_ENV } from "@/lib/ai-client/run-path-flag";

/**
 * 浮窗的**新路径**（P07 任务 3 的组件接线）。
 *
 * ## 为什么单独一个文件
 *
 * 既有的 `agent-panel-assistant-ui.test.tsx`（3456 行）全部 mock 旧路由
 * `/api/agent/floating/chat` —— 它们是**旧路径的守护者**。切流不能让它们
 * 改道（那会让旧路径失去覆盖），因此新路径用独立文件、显式打开开关。
 *
 * 这也是客户端开关「测试环境不恒开」的直接理由：若恒开，那 26 处旧路由
 * mock 会全部走新路径而失败。
 *
 * ## 这一层验证什么
 *
 * 前面几个提交把零件都建好了（run-stream 网络层、floating-adapter 协议翻译、
 * commit-sync 内容同步、floating-run 协调层、floating-history 映射、
 * run-path-flag 开关）。本文件验证**它们真的被组件用起来了**：
 * 发消息时打到 `/api/ai/runs`，且事件流被正确翻译成界面。
 */

/** 让新路径生效：显式打开客户端开关。 */
function enableNewPath() {
  vi.stubEnv(CLIENT_RUN_PATH_ENV, "new");
}

/** 模型配置（新路径要求随请求传）。 */
function configureModel() {
  window.localStorage.setItem(
    "intro-builder.agent.model-settings.v1",
    JSON.stringify({ baseUrl: "https://models.example.test/v1", modelName: "gpt-4.1-mini" }),
  );
  window.sessionStorage.setItem("intro-builder.agent.model-api-key.v1", "sk-local-test");
}

/** 构造一次 SSE 响应。 */
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((event, index) =>
      `data: ${JSON.stringify({
        schemaVersion: 1,
        eventId: `e-${index}`,
        runId: "run-1",
        attemptId: "attempt-1",
        sequence: index + 1,
        type: event.type,
        occurredAt: new Date(0).toISOString(),
        payload: event.payload ?? {},
      })}\n\n`,
    )
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** 浮窗的 props（新路径需要 `runBridge`）。 */
function floatingProps(
  overrides: Partial<React.ComponentProps<typeof FloatingAgentChat>> = {},
) {
  return {
    resumeId: "resume_1",
    title: "前端工程师",
    templateId: "professional",
    getResumeContent: () => emptyResumeContent(),
    completeness: { overall: 80, sections: [] },
    applyOperation: vi.fn(() => true),
    flushAutosave: vi.fn(),
    runBridge: {
      getRevision: () => 3,
      getHasLocalEdits: () => false,
      loadServerContent: async () => emptyResumeContent(),
      applyRemoteCommit: vi.fn(),
    },
    ...overrides,
  };
}

/** 会话列表等旁路请求的统一响应（否则组件会一直显示加载中）。 */
function sessionFetch(handler: (url: string) => Response | null) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const handled = handler(url);
    if (handled) return handled;
    if (url.includes("/api/agent/floating/sessions")) {
      return Response.json({ sessions: [] });
    }
    return Response.json({});
  });
}

function sendMessage(text: string) {
  const input = screen.getByTestId("agent-assistant-ui-composer-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

beforeEach(() => {
  configureModel();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("发消息打到新路由", () => {
  it("**请求发往 /api/ai/runs 而不是旧路由**", async () => {
    const fetchMock = sessionFetch((url) =>
      url === "/api/ai/runs"
        ? sseResponse([
            { type: "text.delta", payload: { text: "好的" } },
            { type: "run.completed" },
          ])
        : null,
    );
    vi.stubGlobal("fetch", fetchMock);
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls).toContain("/api/ai/runs");
      // **不能同时打旧路由** —— 那会双跑两条链路。
      expect(urls).not.toContain("/api/agent/floating/chat");
    });
  });

  it("默认（未开开关）仍走旧路由", async () => {
    const fetchMock = sessionFetch((url) =>
      url === "/api/agent/floating/chat"
        ? Response.json({ message: "旧路径回复", operations: [], toolCalls: [] })
        : null,
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls).toContain("/api/agent/floating/chat");
      expect(urls).not.toContain("/api/ai/runs");
    });
  });
});

describe("事件流被翻译成界面", () => {
  it("**文本增量累积显示**", async () => {
    vi.stubGlobal(
      "fetch",
      sessionFetch((url) =>
        url === "/api/ai/runs"
          ? sseResponse([
              { type: "text.delta", payload: { text: "我看到" } },
              { type: "text.delta", payload: { text: "三个问题" } },
              { type: "run.completed" },
            ])
          : null,
      ),
    );
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    expect(await screen.findByText(/我看到三个问题/)).toBeInTheDocument();
  });

  it("**工具事件渲染成工具卡**", async () => {
    vi.stubGlobal(
      "fetch",
      sessionFetch((url) =>
        url === "/api/ai/runs"
          ? sseResponse([
              { type: "tool.started", payload: { toolCallId: "c1", toolName: "readResume" } },
              { type: "tool.succeeded", payload: { toolCallId: "c1", toolName: "readResume" } },
              { type: "run.completed" },
            ])
          : null,
      ),
    );
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    // 工具卡标题来自业务映射（不是内部工具名）。
    expect(await screen.findByText("读取简历内容")).toBeInTheDocument();
  });

  it("**等待问题渲染成问题卡**", async () => {
    vi.stubGlobal(
      "fetch",
      sessionFetch((url) =>
        url === "/api/ai/runs"
          ? sseResponse([
              {
                type: "run.waiting_user",
                payload: { question: { questionId: "q1", question: "量化结果是什么？" } },
              },
            ])
          : null,
      ),
    );
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    expect(await screen.findByText(/量化结果是什么/)).toBeInTheDocument();
  });
});

describe("请求体契约", () => {
  it("**带上 revision / requestId / modelConfig / history**", async () => {
    const fetchMock = sessionFetch((url) =>
      url === "/api/ai/runs" ? sseResponse([{ type: "run.completed" }]) : null,
    );
    vi.stubGlobal("fetch", fetchMock);
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((item) => String(item[0]) === "/api/ai/runs");
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
      // revision 来自 runBridge（CAS 基准，spec §6 要求与权威一致）。
      expect(body.revision).toBe(3);
      expect(typeof body.requestId).toBe("string");
      expect(body.modelConfig).toEqual({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
        apiKey: "sk-local-test",
      });
      // 首轮无历史（当前消息单独作为 message 传）。
      expect(body.history).toEqual([]);
      expect(body.message).toBe("帮我看看简历");
    });
  });
});

describe("服务端写库后的内容同步", () => {
  it("**有回执时调用 applyRemoteCommit**（否则界面会显示旧内容）", async () => {
    const applyRemoteCommit = vi.fn();
    vi.stubGlobal(
      "fetch",
      sessionFetch((url) =>
        url === "/api/ai/runs"
          ? sseResponse([
              { type: "mutation.committed", payload: { mutationId: "m1", revision: 5 } },
              { type: "run.completed" },
            ])
          : null,
      ),
    );
    enableNewPath();

    render(
      <FloatingAgentChat
        {...floatingProps({
          runBridge: {
            getRevision: () => 3,
            getHasLocalEdits: () => false,
            loadServerContent: async () =>
              ResumeContent.parse({
                ...emptyResumeContent(),
                basics: { ...emptyResumeContent().basics, name: "服务端的名字" },
              }),
            applyRemoteCommit,
          },
        })}
      />,
    );
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    await waitFor(() => {
      expect(applyRemoteCommit).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 5 }),
      );
    });
  });

  it("**无回执时不调用**（诊断类任务没有落盘，不该动表单）", async () => {
    const applyRemoteCommit = vi.fn();
    vi.stubGlobal(
      "fetch",
      sessionFetch((url) =>
        url === "/api/ai/runs"
          ? sseResponse([
              { type: "tool.started", payload: { toolCallId: "c1", toolName: "readResume" } },
              { type: "run.completed" },
            ])
          : null,
      ),
    );
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps({ runBridge: { ...floatingProps().runBridge!, applyRemoteCommit } })} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    await waitFor(() => {
      const urls = fetchMockUrls();
      expect(urls).toContain("/api/ai/runs");
    });
    expect(applyRemoteCommit).not.toHaveBeenCalled();
  });
});

/** 便捷取法：当前 stub 上的 fetch 调用 URL。 */
function fetchMockUrls(): string[] {
  const stub = globalThis.fetch as unknown as { mock?: { calls: unknown[][] } };
  return (stub.mock?.calls ?? []).map((call) => String(call[0]));
}

describe("错误处理", () => {
  it("**非 2xx 时提示错误而不是假装成功**", async () => {
    vi.stubGlobal(
      "fetch",
      sessionFetch((url) =>
        url === "/api/ai/runs"
          ? /*
             * 注意：必须用 `new Response(body, { status })`。
             *
             * `Response.json(payload, 409)` 是**错的** —— 第二个参数是
             * `ResponseInit` 字典，传数字会触发 WebIDL 校验错误
             * （消息形如「Expected 409 to be one of: Null, Undefined, Object」），
             * 而那个错误会被当成服务端返回的文案显示给用户。
             * 实测踩过：断言看到的是 WebIDL 错误而不是真实的业务错误。
             */
            new Response(JSON.stringify({ error: "该简历上已有正在执行的任务", code: "held_by_other" }), {
              status: 409,
              headers: { "content-type": "application/json" },
            })
          : null,
      ),
    );
    enableNewPath();

    render(<FloatingAgentChat {...floatingProps()} />);
    await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" });
    sendMessage("帮我看看简历");

    expect(await screen.findByText(/已有正在执行的任务/)).toBeInTheDocument();
  });
});
