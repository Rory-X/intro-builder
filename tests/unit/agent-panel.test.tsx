import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "@/components/agent/agent-panel";
import { emptyResumeContent } from "@/lib/resume-schema";

describe("AgentPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Agent panel safety copy and workflow entry", () => {
    render(<AgentPanel {...panelProps()} />);

    expect(screen.getByText("简历 Agent")).toBeInTheDocument();
    expect(screen.getByText("AI 会读取当前表单快照，修改需你确认。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "诊断整份简历" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切回编辑" })).toBeInTheDocument();
  });

  it("starts resume diagnosis workflow through the Web BFF", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_test",
          message: {
            id: "msg_assistant_1",
            role: "assistant",
            content: "建议先优化工作经历。",
          },
          toolCalls: [
            {
              id: "tool_1",
              name: "inspect_resume",
              status: "completed",
              title: "检查简历",
              summary: "已检查当前简历。",
              input: {},
              result: {},
            },
          ],
          proposedPatches: [],
          usage: { provider: "test", model: "fake", inputTokens: 1, outputTokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/messages",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("建议先优化工作经历。")).toBeInTheDocument();
    expect(screen.getByText("检查简历")).toBeInTheDocument();
  });

  it("applies proposed patch only after user confirms", async () => {
    const applyPatch = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_test",
          message: {
            id: "msg_assistant_1",
            role: "assistant",
            content: "我准备了一条改写建议。",
          },
          toolCalls: [
            {
              id: "tool_1",
              name: "propose_summary_rewrite",
              status: "completed",
              title: "改写个人总结",
              summary: "生成一版更聚焦的个人总结。",
              input: {},
              result: {},
            },
          ],
          proposedPatches: [
            {
              id: "patch_1",
              toolCallId: "tool_1",
              label: "应用个人总结改写",
              section: "summary",
              fieldPath: "basics.summary",
              operation: "replace_plain_text",
              beforePlainText: "三年前端经验。",
              afterPlainText: "三年前端工程经验，擅长 React 与工程化交付。",
              changeSummary: "让总结更具体。",
              riskFlags: [],
            },
          ],
          usage: { provider: "test", model: "fake", inputTokens: 1, outputTokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel {...panelProps({ applyPatch })} />);
    fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

    expect(applyPatch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "应用" }));
    expect(applyPatch).toHaveBeenCalledWith(expect.objectContaining({ id: "patch_1" }));
  });
});

function panelProps(overrides: Partial<React.ComponentProps<typeof AgentPanel>> = {}) {
  return {
    resumeId: "resume_1",
    title: "前端工程师",
    templateId: "professional",
    getResumeContent: () => emptyResumeContent(),
    completeness: { overall: 80, sections: [] },
    applyPatch: vi.fn(),
    flushAutosave: vi.fn(),
    onBackToEdit: vi.fn(),
    ...overrides,
  };
}
