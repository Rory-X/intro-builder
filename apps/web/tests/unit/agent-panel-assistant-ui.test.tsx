import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

import { AgentPanel } from "@/components/agent/agent-panel";
import { FloatingAgentChat } from "@/components/agent/floating-agent-chat";
import { emptyResumeContent } from "@intro-builder/shared/schemas";

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {
    void _cb;
  }
}

const originalScrollTo = Element.prototype.scrollTo;
const hiddenImplementationTerms = new RegExp(
  ["Ja" + "de", "BY" + "OK"].join("|"),
  "i",
);
const hiddenDefaultModel = "默认" + "模型";

describe("AgentPanel assistant-ui runtime", () => {
  beforeEach(() => {
    toastMocks.error.mockReset();
    toastMocks.success.mockReset();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    if (originalScrollTo) {
      Object.defineProperty(Element.prototype, "scrollTo", {
        configurable: true,
        value: originalScrollTo,
      });
    } else {
      delete (Element.prototype as { scrollTo?: Element["scrollTo"] }).scrollTo;
    }
    vi.unstubAllGlobals();
  });

  function sendMessage(text: string) {
    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  }

  it("renders a minimal empty conversation surface without setup copy", () => {
    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByText("前端工程师")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模型设置" })).toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(screen.getByText("想怎么优化这份简历？")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("输入消息，Enter 发送"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-ui-composer").className).toContain(
      "bg-muted/40",
    );
    expect(screen.getByTestId("agent-assistant-ui-composer-shell").className).toContain(
      "bg-muted/40",
    );
    expect(screen.getByTestId("agent-assistant-ui-composer-shell").className).toContain(
      "focus-within:bg-muted/40",
    );
    expect(
      screen.getByTestId("agent-assistant-ui-composer-input").className,
    ).toContain("bg-transparent");
    expect(
      screen.getByRole("status", { name: "上下文状态：待更新" }),
    ).toBeInTheDocument();
    const emptyContextRing = screen.getByTestId("agent-context-status-ring");
    expect(emptyContextRing).toHaveAttribute("aria-hidden", "true");
    expect(emptyContextRing.className).toContain("h-4");
    expect(emptyContextRing.className).toContain("w-4");
    expect(emptyContextRing.className).toContain("rounded-full");
    expect(screen.queryByText("上下文待更新")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 模式")).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 会读取当前表单快照/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前目标/)).not.toBeInTheDocument();
    expect(screen.queryByText("从这些问题开始")).not.toBeInTheDocument();
  });

  it("renders the floating chat chrome without the old panel controls or implementation keywords", () => {
    vi.stubGlobal("fetch", floatingSessionFetch());
    const { container } = render(<FloatingAgentChat {...floatingProps()} />);

    expect(screen.queryByRole("button", { name: "返回编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "前端工程师" })).not.toBeInTheDocument();
    expect(screen.getByText("前端工程师")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "历史对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "模型设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前模型：连接模型" })).toBeInTheDocument();
    expect(screen.queryByText("自动应用")).not.toBeInTheDocument();
    expect(screen.queryByText(hiddenDefaultModel)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换为手动确认" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "滚动到底部" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(hiddenImplementationTerms);
  });

  it("renders floating avatar chat bubbles with lightweight message actions", async () => {
    const fetchMock = floatingSessionFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<FloatingAgentChat {...floatingProps()} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    sendMessage("请帮我诊断这份简历");

    expect(await screen.findByText("需要先连接模型")).toBeInTheDocument();
    expect(screen.getByText(/请先填写模型服务地址/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接模型" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-user-avatar")).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-avatar")).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-message-bubble").className).toContain(
      "rounded-2xl",
    );
    expect(screen.getAllByRole("button", { name: "复制消息" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "编辑消息" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/agent/floating/chat")).toBe(false);
    expect(container).not.toHaveTextContent(hiddenImplementationTerms);
  });

  it("sends a floating welcome prompt through the same chat route", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return Response.json({
          message: "我会按 STAR 优化最近经历。",
          operations: [],
          toolCalls: [],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    expect(
      await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "按 STAR 优化最近经历" }));

    expect(await screen.findByText("我会按 STAR 优化最近经历。")).toBeInTheDocument();
    const chatCall = findFetchCall(fetchMock, "/api/agent/floating/chat");
    const body = JSON.parse(String(chatCall[1]?.body));
    expect(body.messages).toEqual([
      { role: "user", content: "按 STAR 优化最近经历" },
    ]);
  });

  it("copies floating messages and resends from an edited user message", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    let chatCount = 0;
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        chatCount += 1;
        return Response.json({
          message: chatCount === 1 ? "第一版回答" : "第二版回答",
          operations: [],
          toolCalls: [],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    expect(
      await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" }),
    ).toBeInTheDocument();

    sendMessage("原始问题");
    expect(await screen.findByText("第一版回答")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "复制消息" })[0]);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("原始问题");
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    expect(input).toHaveValue("原始问题");
    expect(screen.getByText("正在编辑上一条消息")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "修改后的问题" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("第二版回答")).toBeInTheDocument();
    expect(screen.queryByText("第一版回答")).not.toBeInTheDocument();
    const chatCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/agent/floating/chat",
    );
    expect(chatCalls).toHaveLength(2);
    const secondBody = JSON.parse(String(chatCalls[1][1]?.body));
    expect(secondBody.messages).toEqual([
      { role: "user", content: "修改后的问题" },
    ]);
  });

  it("regenerates the latest floating assistant reply from the previous user message", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    let chatCount = 0;
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        chatCount += 1;
        return Response.json({
          message: chatCount === 1 ? "第一版回答" : "第二版回答",
          operations: [],
          toolCalls: [],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    expect(
      await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" }),
    ).toBeInTheDocument();

    sendMessage("原始问题");
    expect(await screen.findByText("第一版回答")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新生成回答" }));

    expect(await screen.findByText("第二版回答")).toBeInTheDocument();
    expect(screen.queryByText("第一版回答")).not.toBeInTheDocument();
    const chatCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/agent/floating/chat",
    );
    expect(chatCalls).toHaveLength(2);
    const secondBody = JSON.parse(String(chatCalls[1][1]?.body));
    expect(secondBody.messages).toEqual([
      { role: "user", content: "原始问题" },
    ]);
  });

  it("keeps the latest floating regenerate action visible without hover", async () => {
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_regenerate_visible",
              title: "上一轮诊断",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_regenerate_visible") {
        return Response.json({
          session: {
            id: "session_regenerate_visible",
            title: "上一轮诊断",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_user_regenerate",
              role: "user",
              content: "帮我诊断这份简历",
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:00.000Z",
            },
            {
              id: "msg_assistant_regenerate",
              role: "assistant",
              content: "建议优先加强最近工作经历的结果表达。",
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    const regenerateButton = await screen.findByRole("button", {
      name: "重新生成回答",
    });
    const actionBar = regenerateButton.parentElement;

    expect(actionBar?.className).toContain("absolute");
    expect(actionBar?.className).not.toContain("opacity-0");
    expect(actionBar?.className).not.toContain("group-hover/message:opacity-100");
  });

  it("aborts the active floating request when the user stops generation", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    let capturedSignal: AbortSignal | null = null;
    const fetchMock = floatingSessionFetch(async (url, init) => {
      if (url === "/api/agent/floating/chat") {
        capturedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    expect(
      await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" }),
    ).toBeInTheDocument();

    sendMessage("请直接优化最近经历");

    expect(await screen.findByRole("button", { name: "停止生成" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/请求失败/)).not.toBeInTheDocument();
  });

  it("uses the Next-local floating route and applies returned tool operations when a model is connected", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_1",
      toolCallId: "tool_1",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return Response.json({
        message: "已直接更新最近一段经历。",
        operations: [operation],
        toolCalls: [
          {
            id: "tool_1",
            name: "updateSection",
            status: "completed",
            summary: "强化行动与结果。",
          },
        ],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    expect(
      await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" }),
    ).toBeInTheDocument();
    sendMessage("请直接优化最近经历");

    expect(await screen.findByText("已直接更新最近一段经历。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/floating/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "text/event-stream, application/json" }),
      }),
    );
    const chatCall = findFetchCall(fetchMock, "/api/agent/floating/chat");
    const [, init] = chatCall;
    const body = JSON.parse(String(init?.body));
    expect(body.writeMode).toBe("direct");
    expect(body.modelConfig).toEqual({
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-local-test",
      modelName: "gpt-4.1-mini",
    });
    expect(body.modelConfig.modelName).not.toBe(hiddenDefaultModel);
    expect(applyOperation).toHaveBeenCalledWith(operation);
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /更新简历内容/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /updateSection/ })).not.toBeInTheDocument();
    expect(screen.getByText("强化行动与结果。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /执行结果/ })).not.toBeInTheDocument();
  });

  it("renders approval cards in request-approval mode before applying floating operations", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_approval_1",
      toolCallId: "tool_approval_1",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "pending",
      reason: "approval_required",
      message: "强化行动与结果。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "updateSection" },
      operation,
    };
    const stream = createControlledFloatingStream();
    let chatCount = 0;
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        chatCount += 1;
        if (chatCount === 1) return stream.response;
        return Response.json({
          message: "收到确认，我继续处理。",
          operations: [],
          toolCalls: [],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    switchFloatingWriteMode("请求批准");
    sendMessage("请优化最近经历，但先让我确认");
    await stream.ready;
    expect(screen.getByRole("button", { name: "修改模式：请求批准" })).toBeDisabled();

    const chatCall = findFetchCall(fetchMock, "/api/agent/floating/chat");
    expect(JSON.parse(String(chatCall[1]?.body))).toEqual(
      expect.objectContaining({ writeMode: "approval" }),
    );

    stream.push({ type: "text-delta", delta: "我准备更新最近经历。" });
    stream.push({
      type: "approval-request",
      approvalRequest,
    });
    stream.push({
      type: "done",
      message: "我准备更新最近经历。",
      operations: [],
      approvalRequests: [approvalRequest],
      toolCalls: [],
    });
    stream.close();

    expect(await screen.findByText("强化行动与结果。")).toBeInTheDocument();
    expect(applyOperation).not.toHaveBeenCalled();
    expect(flushAutosave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    expect(applyOperation).toHaveBeenCalledWith(operation);
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/agent/floating/chat"),
      ).toHaveLength(2);
    });
  });

  it("continues a floating approval run after the user applies the approval card", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_approval_continue",
      toolCallId: "tool_approval_continue",
      label: "更新技能",
      section: "skills",
      fieldPath: "skills",
      operation: "update_section",
      beforePlainText: "",
      afterPlainText: "Vue、TypeScript、Node.js",
      changeSummary: "补充前端技能栈。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "pending",
      reason: "approval_required",
      message: "补充前端技能栈。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "suggestSkills" },
      operation,
    };
    const firstStream = createControlledFloatingStream();
    const secondStream = createControlledFloatingStream();
    let chatCount = 0;
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        chatCount += 1;
        return chatCount === 1 ? firstStream.response : secondStream.response;
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    switchFloatingWriteMode("请求批准");
    sendMessage("请补充技能，但等我确认");
    await firstStream.ready;

    firstStream.push({ type: "text-delta", delta: "我准备更新技能。" });
    firstStream.push({ type: "approval-request", approvalRequest });
    firstStream.push({
      type: "done",
      message: "我准备更新技能。",
      operations: [],
      approvalRequests: [approvalRequest],
      toolCalls: [],
    });
    firstStream.close();

    expect(await screen.findByText("补充前端技能栈。")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/agent/floating/chat"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/agent/floating/chat"),
      ).toHaveLength(2);
    });
    const chatCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/agent/floating/chat",
    );
    const continueBody = JSON.parse(String(chatCalls[1][1]?.body));
    expect(continueBody.messages.at(-1)).toEqual({
      role: "assistant",
      content: "我准备更新技能。",
    });
    expect(continueBody.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("已批准并应用"),
        }),
      ]),
    );
    expect(continueBody.approvalDecisions).toEqual([
      {
        approvalId: "floating_tool_approval_continue",
        approved: true,
        operation: "update_section",
        fieldPath: "skills",
        changeSummary: "补充前端技能栈。",
        summary: "补充前端技能栈。",
        label: "更新技能",
      },
    ]);
    expect(applyOperation).toHaveBeenCalledWith(operation);
    expect(flushAutosave).toHaveBeenCalledTimes(1);

    await secondStream.ready;
    secondStream.push({
      type: "text-delta",
      delta: "收到确认，我继续检查其余模块。",
    });
    secondStream.push({
      type: "done",
      message: "收到确认，我继续检查其余模块。",
      operations: [],
      toolCalls: [],
    });
    secondStream.close();

    expect(await screen.findByText("收到确认，我继续检查其余模块。")).toBeInTheDocument();
  });

  it("continues a floating approval run after the user ignores the approval card", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_approval_ignore",
      toolCallId: "tool_approval_ignore",
      label: "更新技能",
      section: "skills",
      fieldPath: "skills",
      operation: "update_section",
      beforePlainText: "",
      afterPlainText: "Vue、TypeScript、Node.js",
      changeSummary: "补充前端技能栈。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "pending",
      reason: "approval_required",
      message: "补充前端技能栈。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "suggestSkills" },
      operation,
    };
    const firstStream = createControlledFloatingStream();
    const secondStream = createControlledFloatingStream();
    let chatCount = 0;
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        chatCount += 1;
        return chatCount === 1 ? firstStream.response : secondStream.response;
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    switchFloatingWriteMode("请求批准");
    sendMessage("请补充技能，但这条我可能不要");
    await firstStream.ready;

    firstStream.push({ type: "text-delta", delta: "我准备更新技能。" });
    firstStream.push({ type: "approval-request", approvalRequest });
    firstStream.push({
      type: "done",
      message: "我准备更新技能。",
      operations: [],
      approvalRequests: [approvalRequest],
      toolCalls: [],
    });
    firstStream.close();

    expect(await screen.findByText("补充前端技能栈。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/agent/floating/chat"),
      ).toHaveLength(2);
    });
    const chatCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/agent/floating/chat",
    );
    const continueBody = JSON.parse(String(chatCalls[1][1]?.body));
    expect(continueBody.messages.at(-1)).toEqual({
      role: "assistant",
      content: "我准备更新技能。",
    });
    expect(continueBody.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("已忽略"),
        }),
      ]),
    );
    expect(continueBody.approvalDecisions).toEqual([
      {
        approvalId: "floating_tool_approval_ignore",
        approved: false,
        operation: "update_section",
        fieldPath: "skills",
        changeSummary: "补充前端技能栈。",
        summary: "补充前端技能栈。",
        label: "更新技能",
      },
    ]);
    expect(applyOperation).not.toHaveBeenCalled();

    await secondStream.ready;
    secondStream.push({
      type: "text-delta",
      delta: "收到，我跳过这条建议继续看其他问题。",
    });
    secondStream.push({
      type: "done",
      message: "收到，我跳过这条建议继续看其他问题。",
      operations: [],
      toolCalls: [],
    });
    secondStream.close();

    expect(
      await screen.findByText("收到，我跳过这条建议继续看其他问题。"),
    ).toBeInTheDocument();
  });

  it("streams floating assistant deltas before applying final tool operations", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_1",
      toolCallId: "tool_1",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const stream = createControlledFloatingStream();
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return stream.response;
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    expect(
      await screen.findByRole("button", { name: "当前模型：gpt-4.1-mini" }),
    ).toBeInTheDocument();
    sendMessage("请直接优化最近经历");
    await stream.ready;

    stream.push({ type: "text-delta", delta: "正在分析" });
    expect(await screen.findByText("正在分析")).toBeInTheDocument();
    expect(applyOperation).not.toHaveBeenCalled();
    expect(flushAutosave).not.toHaveBeenCalled();

    stream.push({ type: "text-delta", delta: "，马上修改。" });
    stream.push({
      type: "done",
      message: "正在分析，马上修改。",
      operations: [operation],
      toolCalls: [
        {
          id: "tool_1",
          name: "updateSection",
          status: "completed",
          summary: "强化行动与结果。",
        },
      ],
    });
    stream.close();

    expect(await screen.findByText("正在分析，马上修改。")).toBeInTheDocument();
    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(operation);
    });
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /更新简历内容/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /updateSection/ })).not.toBeInTheDocument();
  });

  it("does not force floating scroll to bottom while the user is reading older messages", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const stream = createControlledFloatingStream();
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return stream.response;
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<FloatingAgentChat {...floatingProps()} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    sendMessage("请流式诊断这份简历");
    await stream.ready;

    const scrollRegion = container.querySelector(".overflow-y-auto");
    if (!scrollRegion) throw new Error("Missing floating scroll region");
    Object.defineProperty(scrollRegion, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(scrollRegion, "clientHeight", {
      configurable: true,
      value: 360,
    });
    scrollRegion.scrollTop = 240;

    stream.push({ type: "text-delta", delta: "新增的流式回答" });

    expect(await screen.findByText("新增的流式回答")).toBeInTheDocument();
    await Promise.resolve();
    expect(scrollRegion.scrollTop).toBe(240);

    scrollRegion.scrollTop = 1650;
    fireEvent.scroll(scrollRegion);
    stream.push({ type: "text-delta", delta: "，第二段" });

    expect(await screen.findByText("新增的流式回答，第二段")).toBeInTheDocument();
    await Promise.resolve();
    expect(scrollRegion.scrollTop).toBe(2000);
  });

  it("renders floating tool calls during streaming and applies update results before final text", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_update_1",
      toolCallId: "tool_update_1",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const stream = createControlledFloatingStream();
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return stream.response;
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    sendMessage("请先读简历，再优化最近经历");
    await stream.ready;

    stream.push({ type: "text-delta", delta: "我先读取简历。" });
    expect(await screen.findByText("我先读取简历。")).toBeInTheDocument();
    stream.push({
      type: "tool-call-start",
      toolCall: {
        id: "tool_read_1",
        name: "readResume",
        status: "running",
        summary: "读取简历上下文",
        input: {},
      },
    });
    const firstText = await screen.findByText("我先读取简历。");
    const readToolButton = await screen.findByRole("button", { name: /读取简历/ });
    expect(screen.queryByRole("button", { name: /执行结果/ })).not.toBeInTheDocument();

    stream.push({
      type: "tool-call-result",
      toolCall: {
        id: "tool_read_1",
        name: "readResume",
        status: "completed",
        summary: "读取简历上下文",
        input: {},
        output: { success: true, context: { resumeTitle: "前端工程师" } },
      },
      operations: [],
    });
    expect(await screen.findByText("读取简历上下文")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /执行结果/ })).not.toBeInTheDocument();

    stream.push({ type: "text-delta", delta: "我会更新最近经历。" });
    const secondText = await screen.findByText("我会更新最近经历。");
    stream.push({
      type: "tool-call-start",
      toolCall: {
        id: "tool_update_1",
        name: "updateSection",
        status: "running",
        summary: "更新经历",
        input: { fieldPath: "experience.0.content" },
      },
    });
    const updateToolButton = await screen.findByRole("button", { name: /更新简历内容/ });
    stream.push({
      type: "tool-call-result",
      toolCall: {
        id: "tool_update_1",
        name: "updateSection",
        status: "completed",
        summary: "强化行动与结果。",
        input: { fieldPath: "experience.0.content" },
        output: { success: true },
      },
      operations: [operation],
    });
    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(operation);
    });
    expect(flushAutosave).toHaveBeenCalledTimes(1);

    stream.push({ type: "text-delta", delta: "已经更新，并复查了整体表达。" });
    const thirdText = await screen.findByText("已经更新，并复查了整体表达。");
    stream.push({
      type: "done",
      message: "我先读取简历。我会更新最近经历。已经更新，并复查了整体表达。",
      operations: [operation],
      toolCalls: [
        {
          id: "tool_read_1",
          name: "readResume",
          status: "completed",
          summary: "读取简历上下文",
        },
        {
          id: "tool_update_1",
          name: "updateSection",
          status: "completed",
          summary: "强化行动与结果。",
        },
      ],
    });
    stream.close();

    expectNodeBefore(firstText, readToolButton);
    expectNodeBefore(readToolButton, secondText);
    expectNodeBefore(secondText, updateToolButton);
    expectNodeBefore(updateToolButton, thirdText);
    expect(applyOperation).toHaveBeenCalledTimes(1);
    expect(flushAutosave).toHaveBeenCalledTimes(1);
  });

  it("surfaces a direct-write save failure instead of finishing the floating turn", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_save_fail",
      toolCallId: "tool_save_fail",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const flushError = new Error("save failed");
    const flushAutosave = vi.fn(() => Promise.reject(flushError));
    const rollback = vi.fn();
    const applyOperation = vi.fn(() => ({ ok: true as const, rollback }));
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return Response.json({
          message: "已直接更新最近一段经历。",
          operations: [operation],
          toolCalls: [
            {
              id: "tool_save_fail",
              name: "updateSection",
              status: "completed",
              summary: "强化行动与结果。",
            },
          ],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    sendMessage("请直接优化最近经历");

    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(operation);
    });
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("已直接更新最近一段经历。")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith("保存 Agent 修改失败，请稍后重试");
    });
    expect(screen.getByText("请求失败：保存 Agent 修改失败，请稍后重试")).toBeInTheDocument();
    expect(screen.queryByText(/已直接更新最近一段经历/)).not.toBeInTheDocument();
    expect(flushError).toBeInstanceOf(Error);
  });

  it("rolls back a panel operation when the verified save fails", async () => {
    const rollback = vi.fn();
    const applyOperation = vi.fn(() => ({ ok: true as const, rollback }));
    const flushAutosave = vi.fn(() => Promise.reject(new Error("save failed")));
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiWorkspaceResponse(["我准备了一组修改建议。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation, flushAutosave })} />);
    sendMessage("请改写最近经历");

    expect(await screen.findByText("待确认 1 组修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(
        expect.objectContaining({ id: "op_1" }),
      );
    });
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(rollback).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存 Agent 修改失败，请稍后重试",
    );
    expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    expect(screen.queryByText("已应用 1 条修改")).not.toBeInTheDocument();
    expect(screen.queryByText("已应用，等待自动保存。")).not.toBeInTheDocument();
  });

  it("surfaces a direct-write local apply failure before flushing autosave", async () => {
    window.localStorage.setItem(
      "intro-builder.agent.model-settings.v1",
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(
      "intro-builder.agent.model-api-key.v1",
      "sk-local-test",
    );
    const operation = {
      id: "floating_tool_apply_fail",
      toolCallId: "tool_apply_fail",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const flushAutosave = vi.fn();
    const applyOperation = vi.fn(() => false);
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/chat") {
        return Response.json({
          message: "已直接更新最近一段经历。",
          operations: [operation],
          toolCalls: [
            {
              id: "tool_apply_fail",
              name: "updateSection",
              status: "completed",
              summary: "强化行动与结果。",
            },
          ],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    await waitFor(() => {
      expect(findOptionalFetchCall(fetchMock, "/api/agent/floating/sessions/session_1")).toBeTruthy();
    });
    sendMessage("请直接优化最近经历");

    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(operation);
    });
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(screen.queryByText("已直接更新最近一段经历。")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith(
        "这条 Agent 建议暂不支持自动应用",
      );
    });
    expect(
      screen.getByText("请求失败：这条 Agent 建议暂不支持自动应用"),
    ).toBeInTheDocument();
  });

  it("renders floating tool calls as concise summaries by default", async () => {
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_tool_summary",
              title: "工具展示",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_tool_summary") {
        return Response.json({
          session: {
            id: "session_tool_summary",
            title: "工具展示",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_tool_summary",
              role: "assistant",
              content: "我已经整理了技能区。",
              parts: [
                { id: "part_text_tool_summary", type: "text", text: "我已经整理了技能区。" },
                {
                  id: "part_tool_summary",
                  type: "tool",
                  toolCall: {
                    id: "tool_summary",
                    name: "updateSection",
                    status: "completed",
                    summary: "已把技术栈整理进草稿。",
                    input: {
                      fieldPath: "skills.0.keywords",
                      operation: "update_section",
                    },
                    output: {
                      operationIds: ["op_skills"],
                      fieldPath: "skills.0.keywords",
                    },
                  },
                },
              ],
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    expect(await screen.findByText("已把技术栈整理进草稿。")).toBeInTheDocument();
    expect(screen.getByText("更新简历内容")).toBeInTheDocument();
    expect(screen.queryByText("调用参数")).not.toBeInTheDocument();
    expect(screen.queryByText("执行结果")).not.toBeInTheDocument();
    expect(screen.queryByText(/skills\.0\.keywords/)).not.toBeInTheDocument();
    expect(screen.queryByText(/operationIds/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /查看调试信息/ }));

    expect(await screen.findByText(/skills\.0\.keywords/)).toBeInTheDocument();
    expect(screen.getByText(/operationIds/)).toBeInTheDocument();
  });

  it("restores persisted floating message parts in their original text and tool order", async () => {
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_parts",
              title: "交错工具调用",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_parts") {
        return Response.json({
          session: {
            id: "session_parts",
            title: "交错工具调用",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_parts",
              role: "assistant",
              content: "先读取。再更新。最后复查。",
              parts: [
                { id: "part_text_1", type: "text", text: "先读取。" },
                {
                  id: "part_tool_read",
                  type: "tool",
                  toolCall: {
                    id: "tool_read_1",
                    name: "readResume",
                    status: "completed",
                    summary: "读取简历上下文",
                  },
                },
                { id: "part_text_2", type: "text", text: "再更新。" },
                {
                  id: "part_tool_update",
                  type: "tool",
                  toolCall: {
                    id: "tool_update_1",
                    name: "updateSection",
                    status: "completed",
                    summary: "强化行动与结果。",
                  },
                },
                { id: "part_text_3", type: "text", text: "最后复查。" },
              ],
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    const firstText = await screen.findByText("先读取。");
    const readToolButton = await screen.findByRole("button", { name: /读取简历/ });
    const secondText = await screen.findByText("再更新。");
    const updateToolButton = await screen.findByRole("button", { name: /更新简历内容/ });
    const thirdText = await screen.findByText("最后复查。");

    expectNodeBefore(firstText, readToolButton);
    expectNodeBefore(readToolButton, secondText);
    expectNodeBefore(secondText, updateToolButton);
    expectNodeBefore(updateToolButton, thirdText);
    expect(screen.queryByRole("button", { name: /readResume|updateSection/ })).not.toBeInTheDocument();
  });

  it("restores persisted floating approval cards without applying them", async () => {
    const operation = {
      id: "floating_tool_history_approval",
      toolCallId: "tool_history_approval",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "pending",
      reason: "approval_required",
      message: "强化行动与结果。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "updateSection" },
      operation,
    };
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_approval_parts",
              title: "待确认修改",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_approval_parts") {
        return Response.json({
          session: {
            id: "session_approval_parts",
            title: "待确认修改",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_approval_parts",
              role: "assistant",
              content: "我准备了一条修改建议。",
              parts: [
                { id: "part_text_approval", type: "text", text: "我准备了一条修改建议。" },
                {
                  id: "part_approval_history",
                  type: "approval",
                  approvalRequest,
                },
              ],
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    expect(await screen.findByText("我准备了一条修改建议。")).toBeInTheDocument();
    expect(screen.getByText("强化行动与结果。")).toBeInTheDocument();
    expect(applyOperation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(operation);
    });
    await waitFor(() => {
      expect(flushAutosave).toHaveBeenCalledTimes(1);
    });
    let statusUpdateCall:
      | [(RequestInfo | URL), RequestInit?]
      | undefined;
    await waitFor(() => {
      statusUpdateCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/agent/floating/sessions/session_approval_parts" &&
          init?.method === "PATCH",
      );
      expect(statusUpdateCall).toBeTruthy();
    });
    expect(JSON.parse(String(statusUpdateCall?.[1]?.body))).toEqual({
      messageId: "msg_assistant_approval_parts",
      approvalId: operation.id,
      status: "approved",
    });
  });

  it("shows a toast when floating approval status persistence fails", async () => {
    const operation = {
      id: "floating_tool_history_approval_failed",
      toolCallId: "tool_history_approval_failed",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "pending",
      reason: "approval_required",
      message: "强化行动与结果。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "updateSection" },
      operation,
    };
    const fetchMock = floatingSessionFetch(async (url, init) => {
      if (
        url === "/api/agent/floating/sessions/session_approval_failed" &&
        init?.method === "PATCH"
      ) {
        return Response.json({ error: "修改建议不存在" }, { status: 404 });
      }
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_approval_failed",
              title: "待确认修改",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_approval_failed") {
        return Response.json({
          session: {
            id: "session_approval_failed",
            title: "待确认修改",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_approval_failed",
              role: "assistant",
              content: "我准备了一条修改建议。",
              parts: [
                { id: "part_text_approval_failed", type: "text", text: "我准备了一条修改建议。" },
                {
                  id: "part_approval_failed",
                  type: "approval",
                  approvalRequest,
                },
              ],
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    expect(await screen.findByText("我准备了一条修改建议。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    expect(applyOperation).toHaveBeenCalledWith(operation);
    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith("确认状态保存失败");
    });
  });

  it("persists rejected floating approval cards when the user ignores them", async () => {
    const operation = {
      id: "floating_tool_history_rejected",
      toolCallId: "tool_history_rejected",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "pending",
      reason: "approval_required",
      message: "强化行动与结果。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "updateSection" },
      operation,
    };
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_rejected_parts",
              title: "待确认修改",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_rejected_parts") {
        return Response.json({
          session: {
            id: "session_rejected_parts",
            title: "待确认修改",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_rejected_parts",
              role: "assistant",
              content: "我准备了一条修改建议。",
              parts: [
                { id: "part_text_rejected", type: "text", text: "我准备了一条修改建议。" },
                {
                  id: "part_approval_rejected",
                  type: "approval",
                  approvalRequest,
                },
              ],
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    expect(await screen.findByText("我准备了一条修改建议。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));

    expect(applyOperation).not.toHaveBeenCalled();
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(screen.getByText("已忽略这条建议。")).toBeInTheDocument();
    const statusUpdateCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/agent/floating/sessions/session_rejected_parts" &&
        init?.method === "PATCH",
    );
    expect(statusUpdateCall).toBeTruthy();
    expect(JSON.parse(String(statusUpdateCall?.[1]?.body))).toEqual({
      messageId: "msg_assistant_rejected_parts",
      approvalId: operation.id,
      status: "rejected",
    });
  });

  it("keeps persisted resolved floating approval cards from applying twice", async () => {
    const operation = {
      id: "floating_tool_history_approved",
      toolCallId: "tool_history_approved",
      label: "更新经历",
      section: "experience",
      fieldPath: "experience.0.content",
      operation: "update_section",
      beforePlainText: "负责开发。",
      afterPlainText: "主导核心链路优化。",
      changeSummary: "强化行动与结果。",
      riskFlags: [],
    };
    const approvalRequest = {
      id: operation.id,
      status: "approved",
      reason: "approval_required",
      message: "强化行动与结果。",
      toolCallId: operation.toolCallId,
      source: { kind: "tool", name: "updateSection" },
      operation,
    };
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_approved_parts",
              title: "已处理修改",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_approved_parts") {
        return Response.json({
          session: {
            id: "session_approved_parts",
            title: "已处理修改",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_approved_parts",
              role: "assistant",
              content: "这条建议已经应用。",
              parts: [
                { id: "part_text_approved", type: "text", text: "这条建议已经应用。" },
                {
                  id: "part_approval_approved",
                  type: "approval",
                  approvalRequest,
                },
              ],
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();

    render(<FloatingAgentChat {...floatingProps({ applyOperation, flushAutosave })} />);

    expect(await screen.findByText("这条建议已经应用。")).toBeInTheDocument();
    expect(screen.getByText("已应用，等待自动保存。")).toBeInTheDocument();
    const applyButton = screen.getByRole("button", { name: "应用" });
    expect(applyButton).toBeDisabled();

    fireEvent.click(applyButton);

    expect(applyOperation).not.toHaveBeenCalled();
    expect(flushAutosave).not.toHaveBeenCalled();
  });

  it("fetches available models from the connected service and lets the user select one", async () => {
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url === "/api/agent/floating/models") {
        return Response.json({
        models: [
          { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
          { id: "gpt-4.1", label: "gpt-4.1" },
        ],
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "当前模型：连接模型" }));
    expect(screen.getByRole("dialog", { name: "模型设置" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模型服务地址"), {
      target: { value: "https://models.example.test/v1" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "sk-local-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));

    expect(await screen.findByLabelText("选择模型")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/floating/models",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
    const modelCall = findFetchCall(fetchMock, "/api/agent/floating/models");
    const [, init] = modelCall;
    expect(JSON.parse(String(init?.body))).toEqual({
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-local-test",
    });

    fireEvent.change(screen.getByLabelText("选择模型"), {
      target: { value: "gpt-4.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("button", { name: "当前模型：gpt-4.1" })).toBeInTheDocument();
    expect(window.localStorage.getItem("intro-builder.agent.model-settings.v1")).toBe(
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1",
      }),
    );
    expect(window.sessionStorage.getItem("intro-builder.agent.model-api-key.v1")).toBe(
      "sk-local-test",
    );
  });

  it("loads the latest floating chat session and its messages on mount", async () => {
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_history",
              title: "历史优化",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_history") {
        return Response.json({
          session: {
            id: "session_history",
            title: "历史优化",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_user_1",
              role: "user",
              content: "请优化项目经历",
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:00.000Z",
            },
            {
              id: "msg_assistant_1",
              role: "assistant",
              content: "已优化项目经历。",
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    expect(await screen.findByText("请优化项目经历")).toBeInTheDocument();
    expect(screen.getByText("已优化项目经历。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "历史对话" }));
    expect(screen.getAllByText("历史优化").length).toBeGreaterThan(0);
  });

  it("renders floating assistant markdown as rich message content", async () => {
    const fetchMock = floatingSessionFetch(async (url) => {
      if (url.startsWith("/api/agent/floating/sessions?")) {
        return Response.json({
          sessions: [
            {
              id: "session_markdown",
              title: "Markdown 诊断",
              updatedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/agent/floating/sessions/session_markdown") {
        return Response.json({
          session: {
            id: "session_markdown",
            title: "Markdown 诊断",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
          messages: [
            {
              id: "msg_assistant_markdown",
              role: "assistant",
              content: [
                "### 简历诊断",
                "",
                "| 模块 | 建议 |",
                "| --- | --- |",
                "| 经历 | 补充量化结果 |",
                "",
                "- 优先改最近经历",
                "- 保留真实指标",
              ].join("\n"),
              toolCalls: [],
              operations: [],
              createdAt: "2026-06-18T08:00:01.000Z",
            },
          ],
          hasMore: false,
          nextCursor: null,
        });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FloatingAgentChat {...floatingProps()} />);

    expect(
      await screen.findByRole("heading", { name: "简历诊断", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "模块" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "补充量化结果" })).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("优先改最近经历")).toBeInTheDocument();
  });

  it("starts a create-from-zero intake run from the compact welcome action", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["我先确认目标岗位和基础资料。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);

    fireEvent.click(screen.getByRole("button", { name: "从 0 创建简历" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/direct-runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.forwardedProps.introBuilder).toEqual({
      resumeId: null,
      mode: "create_from_zero",
      locale: "zh-CN",
      workflowId: "create-from-zero",
      context: null,
    });
    expect(body.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "从 0 帮我做一份简历",
      }),
    );
    expect(JSON.stringify(body.forwardedProps.introBuilder)).not.toContain(
      "resume_read",
    );
    expect(
      await screen.findByText("我先确认目标岗位和基础资料。"),
    ).toBeInTheDocument();
  });

  it("lets the user configure model preferences from the compact header", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["我会使用你选择的模型继续。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);

    fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    expect(screen.getByRole("dialog", { name: "模型设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("模型服务地址")).toBeInTheDocument();
    expect(screen.getByLabelText("访问密钥")).toBeInTheDocument();
    expect(screen.getByLabelText("模型名称")).toBeInTheDocument();
    expect(screen.queryByText(/AGENT_MODEL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模型服务地址"), {
      target: { value: "https://models.example.test/v1" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "sk-test-local" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "gpt-5-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    sendMessage("请诊断这份简历");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.forwardedProps.introBuilder.modelConfig).toEqual({
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-test-local",
      modelName: "gpt-5-mini",
    });
    expect(
      window.localStorage.getItem("intro-builder.agent.model-settings.v1"),
    ).not.toContain("sk-test-local");
    expect(
      window.sessionStorage.getItem("intro-builder.agent.model-api-key.v1"),
    ).toBe("sk-test-local");
    expect(JSON.stringify(body.forwardedProps.introBuilder)).not.toContain(
      "AGENT_MODEL",
    );
  });

  it("sends free-form composer input through the assistant-ui runtime adapter", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["我会先", "检查内容结构。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    fireEvent.change(input, { target: { value: "请帮我诊断这份简历" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/direct-runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
    });
    expect(await screen.findByText("我会先检查内容结构。")).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-ui-thread")).toBeInTheDocument();
  });

  it("disables composer input while a run is active to avoid duplicate sends", async () => {
    let resolveRun: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return new Promise<Response>((resolve) => {
        resolveRun = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    fireEvent.change(input, { target: { value: "请帮我诊断这份简历" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByRole("button", { name: "停止生成" })).toBeInTheDocument();
    expect(input).toBeDisabled();

    fireEvent.change(input, { target: { value: "请帮我诊断这份简历" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRun?.(agUiResponse(["处理完成。"]));
    expect(await screen.findByText("处理完成。")).toBeInTheDocument();
  });

  it("treats free-form create-from-zero requests as create-from-zero runs", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["我先确认目标岗位。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    sendMessage("从0开始帮我写简历");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.forwardedProps.introBuilder).toEqual(
      expect.objectContaining({
        resumeId: null,
        mode: "create_from_zero",
        locale: "zh-CN",
        workflowId: "create-from-zero",
        context: null,
      }),
    );
  });

  it("renders assistant markdown as formatted content", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse([
        "已检查完毕：\n\n",
        "1. **工作经历**：需要补充量化指标。\n",
        "2. **项目经历**：建议说明 STAR 背景。",
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    fireEvent.change(input, { target: { value: "请检查格式风险" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const strong = await screen.findByText("工作经历", { selector: "strong" });
    expect(strong).toBeInTheDocument();
    expect(screen.queryByText(/\*\*工作经历\*\*/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("项目经历", { selector: "strong" })).toBeInTheDocument();

    const copyButton = screen.getByRole("button", { name: "复制回答" });
    const reloadButton = screen.getByRole("button", { name: "重新生成回答" });
    expect(copyButton.className).not.toContain("border");
    expect(reloadButton.className).not.toContain("border");
    expect(copyButton.parentElement?.className).toContain("absolute");
    expect(copyButton.parentElement?.className).toContain("z-30");
    expect(copyButton.parentElement?.className).toContain("bottom-0");
    expect(copyButton.parentElement?.className).not.toContain("top-full");
    expect(copyButton.parentElement?.parentElement?.className).toContain("pb-8");
  });

  it("keeps user message actions hidden as floating hover controls", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["我会检查这一处。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    sendMessage("帮我找出这份简历里最值得优先修改的一处，并说明原因。");

    expect(await screen.findByText("我会检查这一处。")).toBeInTheDocument();
    const copyMessageButton = screen.getByRole("button", { name: "复制消息" });
    const editMessageButton = screen.getByRole("button", { name: "编辑消息" });
    const actionBar = copyMessageButton.parentElement;

    expect(actionBar).toBe(editMessageButton.parentElement);
    expect(actionBar?.className).toContain("absolute");
    expect(actionBar?.className).toContain("opacity-0");
    expect(actionBar?.className).toContain("group-hover/message:opacity-100");
    expect(actionBar?.className).not.toContain("mt-1 flex");
  });

  it("renders assistant markdown tables as structured table content", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse([
        "## 诊断结果\n\n",
        "| 分区 | 状态 |\n",
        "| --- | --- |\n",
        "| 个人简介 | ❌ 缺失 |\n",
        "| 工作经历 | ✅ 可优化 |\n\n",
        "下一步建议",
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    sendMessage("请输出表格诊断");

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "分区" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "个人简介" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "❌ 缺失" })).toBeInTheDocument();
    expect(screen.queryByText(/\| 分区 \| 状态 \|/)).not.toBeInTheDocument();
  });

  it("can send workflow prompts through the feature-flagged AG-UI runtime without bypassing the Web BFF", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["收到，我会先读取当前简历上下文。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);

    sendMessage("请诊断这份简历");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/direct-runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.forwardedProps.introBuilder).toEqual(
      expect.objectContaining({
        resumeId: "resume_1",
        locale: "zh-CN",
      }),
    );
    expect(body.forwardedProps.introBuilder.context.templateId).toBe("professional");
    expect(body.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "请诊断这份简历",
      }),
    );
    expect(await screen.findByText("收到，我会先读取当前简历上下文。")).toBeInTheDocument();
  });

  it("renders v2 context status in user-facing language without internal parameter names", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiContextStatusResponse(["我会先检查当前简历。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("请诊断这份简历");

    const contextIndicator = await screen.findByRole("status", {
      name: "上下文状态：上下文充足，约 24%",
    });
    expect(contextIndicator).toBeInTheDocument();
    expect(screen.queryByText("上下文充足")).not.toBeInTheDocument();
    expect(screen.queryByText("约 24%")).not.toBeInTheDocument();
    expect(contextIndicator).toHaveAttribute(
      "data-tooltip",
      "上下文用量 24% · 已用约 48k / 200k · 状态：充足",
    );
    const contextTooltip = screen.getByTestId("agent-context-indicator-tooltip");
    expect(contextTooltip).toHaveTextContent("上下文用量 24%");
    expect(contextTooltip).toHaveTextContent("已用约 48k / 200k · 状态：充足");
    expect(contextTooltip.className).toContain("invisible");
    expect(contextTooltip.className).toContain("opacity-0");
    expect(contextTooltip.className).toContain("group-hover/context:visible");
    expect(contextTooltip.className).toContain("group-hover/context:opacity-100");
    expect(contextTooltip.className).toContain("group-focus-within/context:visible");
    expect(contextTooltip.className).toContain(
      "group-focus-within/context:opacity-100",
    );
    expect(contextIndicator.className).toContain("h-6");
    expect(contextIndicator.className).toContain("w-6");
    expect(contextIndicator.className).not.toContain("after:content");
    const contextRing = screen.getByTestId("agent-context-status-ring");
    expect(contextRing).toHaveAttribute("aria-hidden", "true");
    expect(contextRing.className).toContain("h-4");
    expect(contextRing.className).toContain("w-4");
    expect(contextRing.className).toContain("rounded-full");
    expect(contextRing).toHaveAttribute("data-context-usage", "24");
    expect(screen.queryByText(/effectiveInputBudgetTokens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/modelInputLimitTokens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/workspace\.update_facts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/resume_read/)).not.toBeInTheDocument();
  });

  it("projects v2 resume workspace change sets into confirmable cards without exposing state keys", async () => {
    const applyOperation = vi.fn(() => true);
    const flushState = deferredPromise<void>();
    const flushAutosave = vi.fn(() => flushState.promise);
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiWorkspaceResponse(["我准备了一组修改建议。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation, flushAutosave })} />);
    sendMessage("请改写最近经历");

    expect(await screen.findByText("待确认 1 组修改")).toBeInTheDocument();
    expect(screen.getByText("包含 1 条建议")).toBeInTheDocument();
    expect(screen.getByText("应用经历改写")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "op_1",
          fieldPath: "experience.0.content",
          operation: "update_section",
        }),
      );
    });
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    expect(screen.queryByText("已应用 1 条修改")).not.toBeInTheDocument();
    await act(async () => {
      flushState.resolve();
      await flushState.promise;
    });
    expect(await screen.findByText("已应用 1 条修改")).toBeInTheDocument();
    expect(screen.queryByText(/workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/changeset_req_agent/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fieldPath/)).not.toBeInTheDocument();
    expect(screen.queryByText(/resume_update_section/)).not.toBeInTheDocument();
  });

  it("keeps a panel operation pending when local apply fails", async () => {
    const applyOperation = vi.fn(() => false);
    const flushAutosave = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiWorkspaceResponse(["我准备了一组修改建议。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation, flushAutosave })} />);
    sendMessage("请改写最近经历");

    expect(await screen.findByText("待确认 1 组修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "op_1",
          fieldPath: "experience.0.content",
          operation: "update_section",
        }),
      );
    });
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "这条 Agent 建议暂不支持自动应用",
    );
    expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    expect(screen.queryByText("已应用 1 条修改")).not.toBeInTheDocument();
    expect(screen.queryByText("已应用，等待自动保存。")).not.toBeInTheDocument();
  });

  it("shows create-from-zero draft workspace as a simple pending draft status", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiDraftWorkspaceResponse(["我生成了一份待确认的简历草稿。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("从 0 帮我做一份简历");

    expect(await screen.findByText("已生成简历草稿")).toBeInTheDocument();
    expect(screen.getByText("草稿信息待补充")).toBeInTheDocument();
    expect(screen.queryByText("待确认后再写入")).not.toBeInTheDocument();
    expect(screen.getByText("Agent 需要补充信息")).toBeInTheDocument();
    expect(
      screen.getByText(/请补充最近一段经历/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/draftResume/)).not.toBeInTheDocument();
    expect(screen.queryByText(/profileSummary/)).not.toBeInTheDocument();
    expect(screen.queryByText(/create_from_zero/)).not.toBeInTheDocument();
    expect(screen.queryByText(/workspace/)).not.toBeInTheDocument();
  });

  it("does not expose internal Agent state paths in error cards", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiRunErrorResponse("draftResume.profileSummary is required");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("继续");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Agent 服务暂不可用",
    );
    expect(screen.queryByText(/draftResume/)).not.toBeInTheDocument();
    expect(screen.queryByText(/profileSummary/)).not.toBeInTheDocument();
  });

  it("surfaces running AG-UI tool calls from assistant-ui message parts", async () => {
    const toolStream: { finish: (() => void) | null } = { finish: null };
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      const response = delayedAgUiToolResponse({
        onReady: (finish) => {
          toolStream.finish = finish;
        },
        toolCall: {
          id: "tool_read_1",
          name: "resume_read",
          status: "completed",
          title: "读取简历上下文",
          summary: "已读取当前表单快照。",
          input: {},
          result: {},
        },
      });
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByText("Agent 正在处理")).toBeInTheDocument();
    expect(await screen.findByText("正在读取简历")).toBeInTheDocument();
    expect(screen.queryByText(/resume_read/)).not.toBeInTheDocument();
    expect(screen.getByText(/正在读取简历上下文/)).toBeInTheDocument();
    expect(screen.queryByText("读取简历上下文")).not.toBeInTheDocument();

    const finishToolCall = toolStream.finish;
    if (!finishToolCall) {
      throw new Error("Expected delayed AG-UI tool stream to be ready");
    }
    finishToolCall();

    expect(await screen.findByText("读取简历上下文")).toBeInTheDocument();
    expect(await screen.findByText("已完成 1 个动作")).toBeInTheDocument();
    expect(screen.queryByText(/tool:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/resume_read/)).not.toBeInTheDocument();
  });

  it("renders tool cards without exposing internal field paths or debug payloads", async () => {
    const toolStream: { finish: (() => void) | null } = { finish: null };
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return delayedAgUiToolResponse({
        onReady: (finish) => {
          toolStream.finish = finish;
        },
        toolCall: {
          id: "tool_set_skills",
          name: "resume_insert_section",
          status: "completed",
          title: "初始化技能区",
          summary: "已把技术栈整理进草稿。",
          input: {
            operation: "insert_section",
            section: "skills",
            fieldPath: "skills",
          },
          result: { operationIds: ["op_skills"] },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("从 0 帮我写简历");

    expect(await screen.findByText("Agent 正在处理")).toBeInTheDocument();

    const finishToolCall = toolStream.finish;
    if (!finishToolCall) {
      throw new Error("Expected delayed AG-UI tool stream to be ready");
    }
    finishToolCall();

    expect(await screen.findByText("新增条目")).toBeInTheDocument();
    expect(screen.getByText("初始化技能区")).toBeInTheDocument();
    expect(screen.getByText("已把技术栈整理进草稿。")).toBeInTheDocument();
    expect(screen.getByText("已写入草稿")).toBeInTheDocument();
    expect(screen.queryByText(/^skills$/)).not.toBeInTheDocument();
    expect(screen.queryByText("调用参数")).not.toBeInTheDocument();
    expect(screen.queryByText("执行结果")).not.toBeInTheDocument();
    expect(screen.queryByText(/fieldPath/)).not.toBeInTheDocument();
    expect(screen.queryByText(/operationIds/)).not.toBeInTheDocument();
    expect(screen.queryByText(/resume_insert_section/)).not.toBeInTheDocument();
  });

  it("aborts AG-UI runtime runs when the user stops generation", async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async (_url, init) => {
      capturedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByRole("button", { name: "停止生成" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps AG-UI runtime resume operations behind Web-owned confirmation cards", async () => {
    const applyOperation = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiToolLifecycleInterruptResponse({
        text: "我生成了一条可确认的修改建议。",
        toolCall: {
          id: "tool_agui_1",
          name: "resume_update_section",
          status: "completed",
          title: "改写个人总结",
          summary: "保留事实，仅增强 STAR 表达。",
          input: {},
          result: {},
        },
        proposedOperation: {
          id: "op_agui_1",
          toolCallId: "tool_agui_1",
          label: "应用个人总结改写",
          section: "summary",
          fieldPath: "basics.summary",
          operation: "update_section",
          beforePlainText: "负责前端开发。",
          afterPlainText: "负责核心前端模块交付，推动页面性能与协作效率提升。",
          changeSummary: "让职责和影响更清楚。",
          riskFlags: [],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation })} />);
    sendMessage("请诊断这份简历");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("已完成 1 个动作")).toBeInTheDocument();
    });
    expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    expect(await screen.findByText(/改写个人总结/)).toBeInTheDocument();
    expect(screen.getByText("应用个人总结改写")).toBeInTheDocument();
    expect(screen.queryByText("Agent 正在使用工具")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 需要补充信息")).not.toBeInTheDocument();
    expect(applyOperation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(applyOperation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "op_agui_1" }),
    );
  });

  it("does not auto-apply risky operations when auto apply is enabled", async () => {
    window.localStorage.setItem("intro-builder.agent.auto-apply.v1", "true");
    const applyOperation = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiToolLifecycleInterruptResponse({
        text: "我生成了一条需要确认的修改建议。",
        toolCall: {
          id: "tool_risky",
          name: "resume_update_section",
          status: "completed",
          title: "改写经历",
          summary: "包含需要确认的结果指标。",
          input: {},
          result: {},
        },
        proposedOperation: {
          id: "op_risky",
          toolCallId: "tool_risky",
          label: "应用经历改写",
          section: "experience",
          fieldPath: "experience.0.content",
          operation: "update_section",
          beforePlainText: "负责性能优化。",
          afterPlainText: "推动性能优化，提升 50%。",
          changeSummary: "加入结果指标。",
          riskFlags: [
            {
              type: "possible_fabrication",
              message: "需要确认指标来源。",
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation })} />);
    sendMessage("请自动优化这份简历");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    });
    expect(applyOperation).not.toHaveBeenCalled();
    expect(screen.getByText("应用经历改写")).toBeInTheDocument();
  });

  it("renders AG-UI interrupts as answerable question cards and resumes the run", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (Array.isArray(body.resume)) {
        return agUiResponse(["收到补充信息，我继续分析。"]);
      }
      return agUiInterruptResponse([
        {
          id: "interrupt_target_role",
          reason: "input_required",
          message: "你这次主要投递哪个岗位？我需要用它判断经历重点。",
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("请根据目标岗位检查这份简历的匹配度");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText(/Agent 需要补充信息/)).toBeInTheDocument();
    });
    expect(
      screen.getByText("你这次主要投递哪个岗位？我需要用它判断经历重点。"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("你这次主要投递哪个岗位？我需要用它判断经历重点。"),
      {
      target: { value: "增长型前端工程师" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "继续分析" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, resumeInit] = fetchMock.mock.calls[1];
    const resumeBody = JSON.parse(String(resumeInit?.body));
    expect(resumeBody.resume).toEqual([
      {
        interruptId: "interrupt_target_role",
        status: "resolved",
        payload: { answer: "增长型前端工程师" },
      },
    ]);
    expect(await screen.findByText("收到补充信息，我继续分析。")).toBeInTheDocument();
  });

  it("submits approval decisions together with question answers for mixed AG-UI interrupts", async () => {
    const applyOperation = vi.fn();
    const flushAutosave = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (Array.isArray(body.resume)) {
        return agUiResponse(["收到确认和补充信息，我继续分析。"]);
      }
      return agUiToolLifecycleInterruptResponse({
        text: "我先把已知技能写入草稿，然后追问工作经历。",
        toolCall: {
          id: "tool_skills",
          name: "resume_insert_section",
          status: "completed",
          title: "初始化技能区",
          summary: "写入用户提供的技术栈。",
          input: {},
          result: {},
        },
        proposedOperation: {
          id: "op_skills",
          toolCallId: "tool_skills",
          label: "初始化技能区",
          section: "skills",
          fieldPath: "skills",
          operation: "insert_section",
          beforePlainText: "（空）",
          afterPlainText: "Vue、React、TypeScript、Node.js",
          changeSummary: "写入用户提供的技术栈。",
          riskFlags: [],
        },
        extraInterrupts: [
          {
            id: "question_recent_experience",
            reason: "input_required",
            message: "请补充最近一段工作经历。",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation, flushAutosave })} />);
    sendMessage("从 0 帮我写简历");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findAllByText("初始化技能区")).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    });
    expect(screen.getByText("请补充最近一段工作经历。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("请补充最近一段工作经历。"), {
      target: { value: "目前还没有工作经历" },
    });
    expect(screen.getByRole("button", { name: "继续分析" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(
        expect.objectContaining({ id: "op_skills" }),
      );
    });
    await waitFor(() => {
      expect(flushAutosave).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("等待补充信息")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "继续分析" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, resumeInit] = fetchMock.mock.calls[1];
    const resumeBody = JSON.parse(String(resumeInit?.body));
    expect(resumeBody.resume).toEqual([
      {
        interruptId: "op_skills",
        status: "resolved",
        payload: { approved: true },
      },
      {
        interruptId: "question_recent_experience",
        status: "resolved",
        payload: { answer: "目前还没有工作经历" },
      },
    ]);
    expect(
      await screen.findByText("收到确认和补充信息，我继续分析。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/missing responses/)).not.toBeInTheDocument();
  });

  it("submits separate answers for multiple AG-UI question interrupts", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (Array.isArray(body.resume)) {
        return agUiResponse(["收到两条补充信息。"]);
      }
      return agUiInterruptResponse([
        {
          id: "question_target_role",
          reason: "input_required",
          message: "你这次主要投递哪个岗位？",
        },
        {
          id: "question_basic_profile",
          reason: "input_required",
          message: "请补充姓名、当前身份、城市和核心优势。",
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("从 0 帮我做一份简历");

    await waitFor(() => {
      expect(screen.getByText(/Agent 需要补充信息/)).toBeInTheDocument();
    });
    expect(screen.getByText("你这次主要投递哪个岗位？")).toBeInTheDocument();
    expect(
      screen.getByText("请补充姓名、当前身份、城市和核心优势。"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("你这次主要投递哪个岗位？"), {
      target: { value: "增长型前端工程师" },
    });
    fireEvent.change(
      screen.getByLabelText("请补充姓名、当前身份、城市和核心优势。"),
      {
        target: { value: "张三，应届生，上海，React 工程化" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "继续分析" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, resumeInit] = fetchMock.mock.calls[1];
    const resumeBody = JSON.parse(String(resumeInit?.body));
    expect(resumeBody.resume).toEqual([
      {
        interruptId: "question_target_role",
        status: "resolved",
        payload: { answer: "增长型前端工程师" },
      },
      {
        interruptId: "question_basic_profile",
        status: "resolved",
        payload: { answer: "张三，应届生，上海，React 工程化" },
      },
    ]);
    expect(await screen.findByText("收到两条补充信息。")).toBeInTheDocument();
  });
});

function agUiContextStatusResponse(chunks: string[]): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_test" },
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_context_status",
      activityType: "context_status",
      content: {
        effectiveInputBudgetTokens: 200_000,
        modelInputLimitTokens: 214_000,
        reservedOutputTokens: 8_000,
        reservedSystemTokens: 6_000,
        usedInputTokens: 48_000,
        utilization: 0.24,
        status: "healthy",
        policy: "full_context",
        sources: [
          {
            id: "resume_snapshot",
            label: "当前简历",
            kind: "resume_snapshot",
            priority: "required",
            tokenEstimate: 5_200,
            included: true,
            treatment: "raw",
          },
        ],
        lastCompactionAt: null,
        warnings: [],
      },
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_assistant_1",
      role: "assistant",
    },
    ...chunks.map((delta) => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_assistant_1",
      delta,
    })),
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    { type: EventType.RUN_FINISHED, threadId: "resume_1", runId: "req_test" },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function agUiWorkspaceResponse(chunks: string[]): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_agent" },
    {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/workspace",
          value: workspaceSnapshot(),
        },
      ],
    },
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_resume_workspace",
      activityType: "resume_workspace",
      content: workspaceSnapshot(),
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_assistant_1",
      role: "assistant",
    },
    ...chunks.map((delta) => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_assistant_1",
      delta,
    })),
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    { type: EventType.RUN_FINISHED, threadId: "resume_1", runId: "req_agent" },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function agUiDraftWorkspaceResponse(chunks: string[]): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "agent_create_from_zero", runId: "req_agent" },
    {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/workspace",
          value: draftWorkspaceSnapshot(),
        },
      ],
    },
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "msg_resume_workspace",
      activityType: "resume_workspace",
      content: draftWorkspaceSnapshot(),
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_assistant_1",
      role: "assistant",
    },
    ...chunks.map((delta) => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_assistant_1",
      delta,
    })),
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    {
      type: EventType.RUN_FINISHED,
      threadId: "agent_create_from_zero",
      runId: "req_agent",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "question_recent_experience",
            reason: "input_required",
            message:
              "请补充最近一段经历：所在公司/组织、岗位、时间、负责的业务目标、你做了什么、结果如何。",
            metadata: { kind: "question", field: "experience.primary" },
          },
        ],
      },
    },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function workspaceSnapshot() {
  return {
    resumeId: "resume_1",
    mode: "optimize_existing",
    goal: {
      workflowId: "resume-diagnose",
      resumeTitle: "前端工程师",
      targetRole: null,
      locale: "zh-CN",
    },
    facts: [],
    draftResume: null,
    changeSets: [
      {
        id: "changeset_req_agent",
        title: "待确认修改",
        summary: "改写最近经历。",
        status: "staged",
        operationIds: ["op_1"],
        operations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化。",
            changeSummary: "补足任务与行动。",
            riskFlags: [],
          },
        ],
        createdAt: "req_agent",
      },
    ],
    decisions: [],
    qualityReport: null,
    updatedAt: "req_agent",
  };
}

function draftWorkspaceSnapshot() {
  return {
    resumeId: null,
    mode: "create_from_zero",
    goal: {
      workflowId: "create-from-zero",
      resumeTitle: "增长型前端工程师简历草稿",
      targetRole: "增长型前端工程师",
      locale: "zh-CN",
    },
    facts: [
      {
        id: "fact_target_role",
        sectionKey: "goal",
        label: "目标岗位",
        text: "增长型前端工程师",
        source: "user_answer",
        confidence: 1,
      },
    ],
    draftResume: {
      title: "增长型前端工程师简历草稿",
      targetRole: "增长型前端工程师",
      profileSummary: "张三，应届生，上海，React 工程化",
      sections: [
        {
          key: "basics",
          label: "基础信息",
          summary: "张三，应届生，上海，React 工程化",
          status: "drafted",
        },
      ],
      missingFacts: ["工作经历", "项目经历", "教育背景"],
    },
    changeSets: [],
    decisions: [],
    qualityReport: null,
    updatedAt: "req_agent",
  };
}

function agUiResponse(chunks: string[]): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_test" },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_assistant_1",
      role: "assistant",
    },
    ...chunks.map((delta) => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_assistant_1",
      delta,
    })),
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    { type: EventType.RUN_FINISHED, threadId: "resume_1", runId: "req_test" },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function agUiRunErrorResponse(message: string): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_test" },
    {
      type: EventType.RUN_ERROR,
      threadId: "resume_1",
      runId: "req_test",
      message,
      code: "bad_request",
    },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function agUiToolLifecycleInterruptResponse({
  text,
  toolCall,
  proposedOperation,
  extraInterrupts = [],
}: {
  text: string;
  toolCall: unknown;
  proposedOperation: {
    id: string;
    label: string;
    changeSummary: string;
    toolCallId: string;
  } & Record<string, unknown>;
  extraInterrupts?: Array<{
    id: string;
    reason: string;
    message: string;
  }>;
}): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_test" },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_assistant_1",
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_assistant_1",
      delta: text,
    },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: proposedOperation.toolCallId,
      toolCallName: "resume_update_section",
      parentMessageId: "msg_assistant_1",
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: proposedOperation.toolCallId,
      delta: JSON.stringify({ fieldPath: proposedOperation.fieldPath }),
    },
    {
      type: EventType.TOOL_CALL_END,
      toolCallId: proposedOperation.toolCallId,
    },
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: `${proposedOperation.toolCallId}_result`,
      toolCallId: proposedOperation.toolCallId,
      role: "tool",
      content: JSON.stringify({
        toolCall,
        proposedOperations: [proposedOperation],
      }),
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: "resume_1",
      runId: "req_test",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: proposedOperation.id,
            reason: "approval_required",
            message: `${proposedOperation.label}: ${proposedOperation.changeSummary}`,
            toolCallId: proposedOperation.toolCallId,
            metadata: { operation: proposedOperation },
          },
          ...extraInterrupts,
        ],
      },
    },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function delayedAgUiToolResponse({
  onReady,
  toolCall,
}: {
  onReady: (finish: () => void) => void;
  toolCall: unknown;
}): Response {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  function write(event: BaseEvent) {
    controllerRef?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      write({ type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_test" });
      write({
        type: EventType.TOOL_CALL_START,
        toolCallId: "tool_read_1",
        toolCallName: "resume_read",
        parentMessageId: "msg_assistant_1",
      });
      write({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "tool_read_1",
        delta: JSON.stringify({ resumeId: "resume_1" }),
      });
      write({
        type: EventType.TOOL_CALL_END,
        toolCallId: "tool_read_1",
      });
      onReady(() => {
        write({
          type: EventType.TOOL_CALL_RESULT,
          messageId: "tool_read_1_result",
          toolCallId: "tool_read_1",
          role: "tool",
          content: JSON.stringify({ toolCall, proposedOperations: [] }),
        });
        write({
          type: EventType.RUN_FINISHED,
          threadId: "resume_1",
          runId: "req_test",
        });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function agUiInterruptResponse(
  interrupts: Array<{
  id: string;
  reason: string;
  message: string;
  }>,
): Response {
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "resume_1", runId: "req_test" },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_assistant_1",
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_assistant_1",
      delta: "我需要先确认一个关键信息。",
    },
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    {
      type: EventType.RUN_FINISHED,
      threadId: "resume_1",
      runId: "req_test",
      outcome: {
        type: "interrupt",
        interrupts,
      },
    },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function panelProps(overrides: Partial<React.ComponentProps<typeof AgentPanel>> = {}) {
  return {
    resumeId: "resume_1",
    title: "前端工程师",
    templateId: "professional",
    getResumeContent: () => emptyResumeContent(),
    completeness: { overall: 80, sections: [] },
    applyOperation: vi.fn(() => true),
    flushAutosave: vi.fn(),
    onBackToEdit: vi.fn(),
    ...overrides,
  };
}

function floatingProps(overrides: Partial<React.ComponentProps<typeof FloatingAgentChat>> = {}) {
  return {
    resumeId: "resume_1",
    title: "前端工程师",
    templateId: "professional",
    getResumeContent: () => emptyResumeContent(),
    completeness: { overall: 80, sections: [] },
    applyOperation: vi.fn(() => true),
    flushAutosave: vi.fn(),
    ...overrides,
  };
}

function deferredPromise<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

type FetchMock = ReturnType<typeof floatingSessionFetch>;

function floatingSessionFetch(
  extraHandler?: (url: string, init?: RequestInit) => Promise<Response | null> | Response | null,
) {
  return vi.fn<
    (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
  >(async (urlLike, init) => {
    const url = String(urlLike);
    const extra = await extraHandler?.(url, init);
    if (extra) return extra;
    if (url.startsWith("/api/agent/floating/sessions?")) {
      return Response.json({
        sessions: [
          {
            id: "session_1",
            title: "新对话",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
        ],
      });
    }
    if (url === "/api/agent/floating/sessions") {
      return Response.json({
        session: {
          id: "session_new",
          title: "新对话",
          updatedAt: "2026-06-18T08:01:00.000Z",
        },
      });
    }
    if (url.startsWith("/api/agent/floating/sessions/session_")) {
      return Response.json({
        session: {
          id: url.split("/").pop(),
          title: "新对话",
          updatedAt: "2026-06-18T08:00:00.000Z",
        },
        messages: [],
        hasMore: false,
        nextCursor: null,
      });
    }
    return Response.json({});
  });
}

function findFetchCall(fetchMock: FetchMock, url: string) {
  const call = fetchMock.mock.calls.find(([calledUrl]) => String(calledUrl) === url);
  if (!call) throw new Error(`Missing fetch call for ${url}`);
  return call;
}

function findOptionalFetchCall(fetchMock: FetchMock, url: string) {
  return fetchMock.mock.calls.find(([calledUrl]) => String(calledUrl) === url) ?? null;
}

function switchFloatingWriteMode(label: "直接修改" | "请求批准") {
  fireEvent.click(screen.getByRole("button", { name: /修改模式：/ }));
  const option = screen.getByText(label).closest("button");
  if (!option) throw new Error(`Missing floating write mode option: ${label}`);
  fireEvent.click(option);
}

function expectNodeBefore(first: Element, second: Element) {
  expect(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function createControlledFloatingStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      markReady();
    },
  });
  return {
    ready,
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push(event: Record<string, unknown>) {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      controller?.close();
    },
  };
}
