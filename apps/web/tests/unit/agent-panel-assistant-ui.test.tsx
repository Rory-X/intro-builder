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
        "/api/agent/runs",
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

  it("projects v2 resume workspace change sets without exposing state keys", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return agUiWorkspaceResponse(["我准备了一组修改建议。"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({})} />);
    sendMessage("请改写最近经历");

    expect(await screen.findByText("待确认 1 组修改")).toBeInTheDocument();
    expect(screen.getByText("包含 1 条建议")).toBeInTheDocument();
    expect(screen.queryByText(/workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/changeset_req_agent/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fieldPath/)).not.toBeInTheDocument();
    expect(screen.queryByText(/resume_update_section/)).not.toBeInTheDocument();
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
    expect(screen.getByText("待确认后再写入")).toBeInTheDocument();
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
}: {
  text: string;
  toolCall: unknown;
  proposedOperation: {
    id: string;
    label: string;
    changeSummary: string;
    toolCallId: string;
  } & Record<string, unknown>;
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
    applyOperation: vi.fn(),
    flushAutosave: vi.fn(),
    onBackToEdit: vi.fn(),
    ...overrides,
  };
}
