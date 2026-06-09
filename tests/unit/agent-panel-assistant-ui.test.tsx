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
