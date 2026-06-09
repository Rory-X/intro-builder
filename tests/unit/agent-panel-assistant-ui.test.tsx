import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "@/components/agent/agent-panel";
import { emptyResumeContent } from "@/lib/resume-schema";

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {
    void _cb;
  }
}

const originalScrollTo = Element.prototype.scrollTo;

describe("AgentPanel assistant-ui runtime", () => {
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
        "/api/agent/runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
    });
    expect(await screen.findByText("我会先检查内容结构。")).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-ui-thread")).toBeInTheDocument();
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
  });

  it("can send workflow prompts through the feature-flagged AG-UI runtime without bypassing the Web BFF", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse(["收到，我会先读取当前简历上下文。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ runtimeMode: "ag-ui" })} />);

    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/runs",
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
        workflowId: "resume-diagnose",
      }),
    );
    expect(body.forwardedProps.runConfig).toEqual(
      expect.objectContaining({ workflowId: "resume-diagnose" }),
    );
    expect(body.forwardedProps.introBuilder.context.templateId).toBe("professional");
    expect(body.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "请诊断这份简历，并优先指出最值得修改的一处。",
      }),
    );
    expect(await screen.findByText("收到，我会先读取当前简历上下文。")).toBeInTheDocument();
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

    render(<AgentPanel {...panelProps({ runtimeMode: "ag-ui" })} />);
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    expect(await screen.findByText("Agent 正在使用工具")).toBeInTheDocument();
    expect(await screen.findByText("正在执行工具 resume_read")).toBeInTheDocument();
    expect(screen.getByText(/正在读取简历上下文/)).toBeInTheDocument();
    expect(screen.queryByText("读取简历上下文")).not.toBeInTheDocument();

    const finishToolCall = toolStream.finish;
    if (!finishToolCall) {
      throw new Error("Expected delayed AG-UI tool stream to be ready");
    }
    finishToolCall();

    expect(await screen.findByText("读取简历上下文")).toBeInTheDocument();
    expect(await screen.findByText("已完成 1 个工具调用")).toBeInTheDocument();
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

    render(<AgentPanel {...panelProps({ runtimeMode: "ag-ui" })} />);
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

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
      return agUiResponseWithToolResult({
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

    render(<AgentPanel {...panelProps({ applyOperation, runtimeMode: "ag-ui" })} />);
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("已完成 1 个工具调用")).toBeInTheDocument();
    });
    expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
    expect(await screen.findByText(/改写个人总结/)).toBeInTheDocument();
    expect(screen.getByText("应用个人总结改写")).toBeInTheDocument();
    expect(applyOperation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(applyOperation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "op_agui_1" }),
    );
  });

  it("renders AG-UI interrupts as answerable question cards and resumes the run", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (Array.isArray(body.resume)) {
        return agUiResponse(["收到补充信息，我继续分析。"]);
      }
      return agUiInterruptResponse({
        id: "interrupt_target_role",
        reason: "input_required",
        message: "你这次主要投递哪个岗位？我需要用它判断经历重点。",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ runtimeMode: "ag-ui" })} />);
    fireEvent.click(screen.getByRole("button", { name: "目标岗位匹配" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText(/Agent 需要补充信息/)).toBeInTheDocument();
    });
    expect(
      screen.getByText("你这次主要投递哪个岗位？我需要用它判断经历重点。"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("补充信息"), {
      target: { value: "增长型前端工程师" },
    });
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
});

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
      messageId: "tool_agui_1_result",
      toolCallId: "tool_agui_1",
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

function agUiInterruptResponse({
  id,
  reason,
  message,
}: {
  id: string;
  reason: string;
  message: string;
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
      delta: "我需要先确认一个关键信息。",
    },
    { type: EventType.TEXT_MESSAGE_END, messageId: "msg_assistant_1" },
    {
      type: EventType.RUN_FINISHED,
      threadId: "resume_1",
      runId: "req_test",
      outcome: {
        type: "interrupt",
        interrupts: [{ id, reason, message }],
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
    applyOperation: vi.fn(),
    flushAutosave: vi.fn(),
    onBackToEdit: vi.fn(),
    ...overrides,
  };
}
