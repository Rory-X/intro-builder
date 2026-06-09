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

  it("renders Agent panel safety copy and workflow entry", () => {
    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByText("简历 Agent")).toBeInTheDocument();
    expect(screen.getByText("AI 会读取当前表单快照，修改需你确认。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "诊断整份简历" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切回编辑" })).toBeInTheDocument();
  });

  it("renders assistant-ui thread and composer primitives inside the panel", () => {
    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByTestId("agent-assistant-ui-thread")).toBeInTheDocument();
    expect(screen.getByTestId("agent-assistant-ui-composer-input")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.workflowId).toBe("resume-diagnose");
    expect(body.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: "请诊断这份简历，并优先指出最值得修改的一处。",
      }),
    );
    expect(await screen.findByText("建议先优化工作经历。")).toBeInTheDocument();
    expect(screen.getByText("检查简历")).toBeInTheDocument();
  });

  it("applies proposed operation only after user confirms", async () => {
    const applyOperation = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiResponse({
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
        proposedOperations: [
            {
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
          ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyOperation })} />);
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    expect(applyOperation).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "应用" }));
    expect(applyOperation).toHaveBeenCalledWith(expect.objectContaining({ id: "op_1" }));
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
    { type: EventType.RUN_FINISHED, threadId: "resume_1", runId: "req_test" },
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
