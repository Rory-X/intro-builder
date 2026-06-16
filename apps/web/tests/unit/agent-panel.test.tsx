import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "@/components/agent/agent-panel";
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

describe("AgentPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
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
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
  }

  it("renders a compact conversation header and composer status", () => {
    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByText("新对话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回编辑" })).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "上下文状态：待更新" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("上下文待更新")).not.toBeInTheDocument();
    expect(screen.queryByText("简历 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 会读取当前表单快照/)).not.toBeInTheDocument();
  });

  it("renders assistant-ui thread and composer primitives inside the panel", () => {
    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByTestId("agent-assistant-ui-thread")).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-ui-composer-input")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "滚动到底部" })).toBeInTheDocument();
  });

  it("renders welcome suggestions and sends them through the thread runtime", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
        text: "我会先找最值得修改的一处。",
        toolCalls: [],
        proposedOperations: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(screen.getByText("想怎么优化这份简历？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "帮我找最值得改的一处" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "帮我找出这份简历里最值得优先修改的一处，并说明原因。",
      }),
    );
    expect(await screen.findByText("我会先找最值得修改的一处。")).toBeInTheDocument();
  });

  it("starts resume diagnosis workflow through the Web BFF", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
        text: "建议先优化工作经历。",
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_read",
            status: "completed",
            title: "检查简历",
            summary: "已检查当前简历。",
            input: {},
            result: {},
          },
        ],
        proposedOperations: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
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
    expect(body.forwardedProps.introBuilder.resumeId).toBe("resume_1");
    expect(body.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "请诊断这份简历",
      }),
    );
    expect(await screen.findByText("建议先优化工作经历。")).toBeInTheDocument();
    expect(screen.getByText("检查简历")).toBeInTheDocument();
  });

  it("renders assistant copy and retry actions without touching resume state", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const applyOperation = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
        text: "建议先优化工作经历。",
        toolCalls: [],
        proposedOperations: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation })} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByText("建议先优化工作经历。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制回答" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("建议先优化工作经历。");
    });

    fireEvent.click(screen.getByRole("button", { name: "重新生成回答" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(applyOperation).not.toHaveBeenCalled();
  });

  it("lets the user edit a sent message and rerun the Agent", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
        text: "我会按新的问题重新检查。",
        toolCalls: [],
        proposedOperations: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    fireEvent.change(input, { target: { value: "请检查格式风险" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("我会按新的问题重新检查。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));

    const editInput = await screen.findByTestId("agent-edit-message-input");
    expect(editInput).toHaveValue("请检查格式风险");
    fireEvent.change(editInput, {
      target: { value: "请重新检查内容结构和格式风险" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并重新发送" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, editInit] = fetchMock.mock.calls[1];
    const editBody = JSON.parse(String(editInit?.body));
    expect(editBody.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "请重新检查内容结构和格式风险",
      }),
    );
  });

  it("shows assistant-side loading while waiting for the first streamed text", async () => {
    const pendingResponse = deferred<Response>();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(() => pendingResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByTestId("agent-loading-indicator")).toHaveTextContent(
      "正在读取简历上下文",
    );
    expect(screen.getByText(/正在读取简历上下文/)).toBeInTheDocument();
    expect(screen.queryByText("Agent 活动")).not.toBeInTheDocument();

    pendingResponse.resolve(
      agUiResponse({
        text: "建议先优化工作经历。",
        toolCalls: [],
        proposedOperations: [],
      }),
    );

    expect(await screen.findByText("建议先优化工作经历。")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("agent-loading-indicator")).not.toBeInTheDocument();
    });
  });

  it("lets the user stop a pending Agent response without showing an error", async () => {
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

    render(<AgentPanel {...panelProps()} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByRole("button", { name: "停止生成" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("agent-loading-indicator")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-ui-composer-input")).toBeEnabled();
  });

  it("renders Agent errors without exposing internal codes or request ids", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return Response.json(
        {
          error: "Agent 服务暂不可用",
          code: "dependency_unavailable",
          requestId: "req_agent_debug",
        },
        { status: 503 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByText("Agent 服务暂不可用")).toBeInTheDocument();
    expect(screen.queryByText(/dependency_unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/req_agent_debug/)).not.toBeInTheDocument();
  });

  it("lets the user retry the last Agent request after a transient error", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: "Agent 服务暂不可用",
            code: "dependency_unavailable",
            requestId: "req_retry_once",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        agUiResponse({
          text: "重试成功，我继续检查。",
          toolCalls: [],
          proposedOperations: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByText("Agent 服务暂不可用")).toBeInTheDocument();
    expect(screen.queryByText(/req_retry_once/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发送上一条" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, retryInit] = fetchMock.mock.calls[1];
    const retryBody = JSON.parse(String(retryInit?.body));
    expect(retryBody.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "请诊断这份简历",
      }),
    );
    expect(await screen.findByText("重试成功，我继续检查。")).toBeInTheDocument();
    expect(screen.queryByText(/req_retry_once/)).not.toBeInTheDocument();
  });

  it("recovers from Agent error and allows retry", async () => {
    let callCount = 0;
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      callCount++;
      if (callCount === 1) {
        // First call returns 503 error
        return Response.json(
          {
            error: "Agent 服务暂不可用",
            code: "dependency_unavailable",
            requestId: "req_retry_test",
          },
          { status: 503 },
        );
      }
      // Second call returns success
      return agUiResponse({
        text: "错误已恢复，我继续检查。",
        toolCalls: [],
        proposedOperations: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
    sendMessage("请诊断这份简历");

    // Wait for error card to appear
    expect(await screen.findByText("Agent 服务暂不可用")).toBeInTheDocument();
    expect(screen.queryByText(/req_retry_test/)).not.toBeInTheDocument();

    // Click retry button
    fireEvent.click(screen.getByRole("button", { name: "重新发送上一条" }));

    // Wait for second fetch call
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Wait for success response
    expect(await screen.findByText("错误已恢复，我继续检查。")).toBeInTheDocument();

    // Error card should be gone
    expect(screen.queryByText(/req_retry_test/)).not.toBeInTheDocument();
  });

  it("applies proposed operation only after user confirms", async () => {
    const applyOperation = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponseWithToolResult({
        text: "我准备了一条改写建议。",
        toolCall: {
          id: "tool_1",
          name: "resume_update_section",
          status: "completed",
          title: "改写个人总结",
          summary: "生成一版更聚焦的个人总结。",
          input: {},
          result: {},
        },
        proposedOperation: {
          id: "op_1",
          toolCallId: "tool_1",
          label: "应用个人总结改写",
          section: "summary",
          fieldPath: "basics.summary",
          operation: "update_section",
          beforePlainText: "三年前端经验。",
          afterPlainText: "三年前端工程经验，擅长 React 与工程化交付。",
          changeSummary: "让总结更具体。",
          riskFlags: [],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation })} />);
    sendMessage("请诊断这份简历");

    // Step 1: applyOperation should not be called yet
    expect(applyOperation).not.toHaveBeenCalled();

    // Step 2: wait for tool call to complete
    await waitFor(() => {
      expect(screen.getByText("已完成 1 个动作")).toBeInTheDocument();
    });

    // Step 3: wait for confirmation card to appear
    expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("应用个人总结改写")).toBeInTheDocument();
    });

    // Step 4: verify applyOperation still not called
    expect(applyOperation).not.toHaveBeenCalled();

    // Step 5: click apply button
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    // Step 6: verify applyOperation was called with correct arguments
    expect(applyOperation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "op_1" }),
    );

    // Step 7: wait for status update
    await waitFor(() => {
      expect(screen.getByText("已应用")).toBeInTheDocument();
    });
  });

  it.skip("keeps finished tool cards with their original turn instead of pinning them under newer messages", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >()
      .mockResolvedValueOnce(
        agUiResponse({
          text: "我准备了一条改写建议。",
          toolCalls: [
            {
              id: "tool_1",
              name: "resume_update_section",
              status: "completed",
              title: "改写个人总结",
              summary: "生成一版更聚焦的个人总结。",
              input: {},
              result: {},
            },
          ],
          proposedOperations: [],  // No operations, so no interrupt
        }),
      )
      .mockResolvedValueOnce(
        agUiResponse({
          text: "项目经历需要补充结果指标。",
          toolCalls: [],
          proposedOperations: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
    sendMessage("请诊断这份简历");

    expect(await screen.findByText("改写个人总结")).toBeInTheDocument();

    const input = screen.getByTestId("agent-assistant-ui-composer-input");
    fireEvent.change(input, { target: { value: "继续帮我检查项目经历" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const nextUserMessage = await screen.findByText("继续帮我检查项目经历");
    expect(await screen.findByText("项目经历需要补充结果指标。")).toBeInTheDocument();
    const toolCard = screen.getByText("改写个人总结");
    expect(toolCard.closest("[data-testid='agent-turn-artifacts']")).toHaveAttribute(
      "data-agent-turn-status",
      "complete",
    );
    expect(
      toolCard.compareDocumentPosition(nextUserMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("submits interrupt response when user approves an operation", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
        text: "我建议优化这段经历。",
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const applyOperation = vi.fn();
    render(<AgentPanel {...panelProps({ applyOperation })} />);

    sendMessage("请诊断这份简历");

    await waitFor(() => {
      expect(screen.getByText("应用经历改写")).toBeInTheDocument();
    });

    // Click "应用" button
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    // Verify applyOperation was called
    await waitFor(() => {
      expect(applyOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "op_1",
          label: "应用经历改写",
        }),
      );
    });

    // Verify interrupt response was submitted
    await waitFor(() => {
      const resumeCalls = fetchMock.mock.calls.filter((call) => {
        const body = JSON.parse(String(call[1]?.body));
        return body.resume && Array.isArray(body.resume);
      });
      expect(resumeCalls.length).toBeGreaterThan(0);
      const resumeBody = JSON.parse(String(resumeCalls[0][1]?.body));
      expect(resumeBody.resume).toContainEqual({
        interruptId: "op_1",
        status: "resolved",
        payload: { approved: true },
      });
    });
  });

  it("submits interrupt response when user rejects an operation", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
        text: "我建议优化这段经历。",
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);

    sendMessage("请诊断这份简历");

    await waitFor(() => {
      expect(screen.getByText("应用经历改写")).toBeInTheDocument();
    });

    // Click "忽略" button
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));

    // Verify interrupt response was submitted with cancelled status
    await waitFor(() => {
      const resumeCalls = fetchMock.mock.calls.filter((call) => {
        const body = JSON.parse(String(call[1]?.body));
        return body.resume && Array.isArray(body.resume);
      });
      expect(resumeCalls.length).toBeGreaterThan(0);
      const resumeBody = JSON.parse(String(resumeCalls[0][1]?.body));
      expect(resumeBody.resume).toContainEqual({
        interruptId: "op_1",
        status: "cancelled",
        payload: { approved: false },
      });
    });
  });
});

function agUiResponse({
  text,
  toolCalls,
  proposedOperations,
}: {
  text: string;
  toolCalls: unknown[];
  proposedOperations: unknown[];
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
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    ...toolCalls.map((toolCall) => ({
      type: EventType.TOOL_CALL_RESULT,
      messageId: `${(toolCall as { id: string }).id}_result`,
      toolCallId: (toolCall as { id: string }).id,
      role: "tool" as const,
      content: JSON.stringify({ toolCall, proposedOperations }),
    })),
  ];

  // If there are operations, output interrupt instead of success
  const ops = proposedOperations as Array<{ id: string; label: string; changeSummary: string; toolCallId: string }>;
  if (ops.length > 0) {
    events.push({
      type: EventType.RUN_FINISHED,
      threadId: "resume_1",
      runId: "req_test",
      outcome: {
        type: "interrupt",
        interrupts: ops.map((op) => ({
          id: op.id,
          reason: "approval_required",
          message: `${op.label}: ${op.changeSummary}`,
          toolCallId: op.toolCallId,
          metadata: { operation: op },
        })),
      },
    });
  } else {
    events.push({ type: EventType.RUN_FINISHED, threadId: "resume_1", runId: "req_test" });
  }

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function agUiResponseWithToolResult({
  text,
  toolCall,
  proposedOperation,
}: {
  text: string;
  toolCall: unknown;
  proposedOperation: unknown;
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
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "tool_1_result",
      toolCallId: "tool_1",
      role: "tool",
      content: JSON.stringify({
        toolCall,
        proposedOperations: [proposedOperation],
      }),
    },
    { type: EventType.RUN_FINISHED, threadId: "resume_1", runId: "req_test" },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function panelProps(overrides: Partial<React.ComponentProps<typeof AgentPanel>> = {}) {
  return {
    resumeId: "resume_1",
    title: "前端工程师",
    templateId: "professional",
    getResumeContent: () => emptyResumeContent(),
    completeness: { overall: 80, sections: [] },
    applyOperation: vi.fn(),
    flushAutosave: vi.fn(),
    onBackToEdit: vi.fn(),
    ...overrides,
  };
}
