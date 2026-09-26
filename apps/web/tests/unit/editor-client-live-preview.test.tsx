import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorClient from "@/app/(app)/resume/[id]/edit/editor-client";
import { DEFAULT_STYLE_SETTINGS, emptyResumeContent } from "@intro-builder/shared/schemas";
import type { AllTemplatesItem } from "@/lib/templates/registry";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

const DB_RESOLVED: SerializableResolvedTemplate = {
  source: "unified",
  id: "professional",
  html: '<article><h1><slot data-bind="basic.name"></slot></h1><slot data-bind="sectionOrder" data-template="section"></slot></article><template id="section-block"><section><slot data-bind="section.body"></slot></section></template><template id="section-list"><section><slot data-bind="section.items" data-template="item"></slot></section></template><template id="item"><div><slot data-bind="item.title"></slot></div></template>',
  css: null,
  templateId: "professional",
  sectionIcons: {},
};

const DB_TEMPLATE_ROWS: AllTemplatesItem[] = [
  {
    id: "professional",
    name: "专业",
    description: "单栏清晰",
    thumbnailUrl: null,
    source: "uploaded",
    defaultStyleSettings: DEFAULT_STYLE_SETTINGS,
    category: "tech",
  },
  {
    id: "classic",
    name: "经典",
    description: "黑白单栏",
    thumbnailUrl: null,
    source: "uploaded",
    defaultStyleSettings: DEFAULT_STYLE_SETTINGS,
    category: "business",
  },
  {
    id: "modern",
    name: "现代",
    description: "技术风双栏",
    thumbnailUrl: null,
    source: "uploaded",
    defaultStyleSettings: DEFAULT_STYLE_SETTINGS,
    category: "tech",
  },
];

const saveResumeMock = vi.fn();
const submitResumeMutationMock = vi.fn();
const exportPreviewImageMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/app/(app)/resume/[id]/edit/actions", () => ({
  saveResume: (...args: unknown[]) => saveResumeMock(...args),
  // 编辑器写入现在统一走提交模块：旧 saveResume 仍在导出，但不再被编辑器调用。
  submitResumeMutation: (...args: unknown[]) => submitResumeMutationMock(...args),
  setTemplate: vi.fn(),
  toggleShare: vi.fn(),
}));

vi.mock("@/lib/client/export-preview-image", () => ({
  exportPreviewImage: (...args: unknown[]) => exportPreviewImageMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

describe("EditorClient live preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveResumeMock.mockReset();
    saveResumeMock.mockResolvedValue(undefined);
    submitResumeMutationMock.mockReset();
    // 模拟服务端回执：revision 前进一位，回传服务端内容。
    submitResumeMutationMock.mockImplementation(async (input: { expectedRevision: number }) => ({
      status: "committed",
      revision: input.expectedRevision + 1,
      versionId: "v-test",
    }));
    exportPreviewImageMock.mockReset();
    exportPreviewImageMock.mockResolvedValue(undefined);
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    // jsdom doesn't do layout — scrollHeight is always 0. PaginatedPreview
    // guards visible page rendering behind `measured` which requires
    // scrollHeight > 0. Stub it so the preview content actually renders.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() { return 800; },
    });
    // PaginatedPreview uses ResizeObserver to compute scale; without it
    // scale stays null and visible pages get visibility:hidden.
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("keeps the server-resolved unified template for classic", () => {
    const content = emptyResumeContent();
    content.basics.name = "统一渲染";
    const unifiedResolved: SerializableResolvedTemplate = {
      source: "unified",
      id: "classic",
      templateId: "classic",
      html: '<main class="unified-probe"><slot data-bind="basic.name"></slot></main>',
      css: ".unified-probe { color: black; }",
    };

    const { container } = render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="classic"
        initialContent={content}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={unifiedResolved}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    expect(container.querySelector('[data-template-id="classic"] .unified-probe')).not.toBeNull();
    expect(screen.getAllByText("统一渲染").length).toBeGreaterThan(0);
  });

  it("updates preview and autosaves changed registered field values", async () => {
    const content = emptyResumeContent();
    content.basics.name = "旧姓名";

    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={content}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    expect(screen.getAllByLabelText("姓名")).toHaveLength(1);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("姓名"), {
        target: { value: "新姓名" },
      });
    });

    expect(screen.getByRole("heading", { name: "新姓名" })).toBeInTheDocument();
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("待保存");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    /*
     * 断言升级为「语义操作」而不是「整份内容被保存」：
     * 我们要证明的是「用户输入的字段值，以针对该字段的操作形式抵达了服务端」，
     * 这比「某个大对象里有新值」更强 —— 它同时证明了目标定位正确。
     */
    expect(submitResumeMutationMock).toHaveBeenCalled();
    const lastCall = submitResumeMutationMock.mock.calls.at(-1)?.[0] as {
      expectedRevision: number;
      mutationId: string;
      operations: Array<{ kind: string; target?: { section?: string; field?: string }; value?: unknown }>;
    };
    const nameOp = lastCall.operations.find(
      (operation) =>
        operation.kind === "set_field" &&
        operation.target?.section === "basics" &&
        operation.target?.field === "name",
    );
    expect(nameOp).toBeDefined();
    expect(nameOp?.value).toBe("新姓名");
    // 必须携带 revision 与稳定 mutationId，否则并发保护失效。
    expect(lastCall.expectedRevision).toBe(0);
    expect(typeof lastCall.mutationId).toBe("string");
    // 旧的无 revision 覆盖写路径不得再被编辑器调用。
    expect(saveResumeMock).not.toHaveBeenCalled();
  });

  it("renders template and layout settings in the toolbar only", () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    const toolbar = screen.getByTestId("editor-toolbar");
    expect(toolbar).toHaveTextContent("排版");
    expect(screen.getAllByRole("button", { name: "排版" })).toHaveLength(1);

    const templateButton = screen.getByRole("button", { name: "模板" });
    fireEvent.click(templateButton);
    expect(templateButton.className).toContain("bg-primary/5");
    expect(templateButton.className).toContain("font-semibold");
    expect(templateButton.className).toContain("text-primary");
    expect(templateButton.className).not.toContain("text-primary-foreground");
  });

  it("mounts first-visit onboarding and reopens it from the editor toolbar", async () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole("region", { name: "编辑器新手引导" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "以后再说" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.queryByRole("region", { name: "编辑器新手引导" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新手引导" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole("region", { name: "编辑器新手引导" }),
    ).toBeInTheDocument();
  });

  it("keeps the existing Agent panel entry by default", () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Agent 模式" })).toHaveAttribute(
      "data-editor-onboarding-target",
      "agent",
    );
    expect(
      screen.queryByRole("button", { name: "打开 AI 简历助手" }),
    ).not.toBeInTheDocument();
  });

  it("uses a floating assistant when the agent surface is enabled", () => {
    window.localStorage.setItem("intro-builder.agent.auto-apply.v1", "false");

    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        agentSurface="floating"
        from={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Agent 模式" })).not.toBeInTheDocument();

    const floatingAgentButton = screen.getByRole("button", {
      name: "打开 AI 简历助手",
    });
    expect(floatingAgentButton).toHaveAttribute(
      "data-editor-onboarding-target",
      "agent",
    );
    fireEvent.click(floatingAgentButton);

    expect(screen.getByRole("dialog", { name: "AI 简历助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前模型：连接模型" })).toBeInTheDocument();
    expect(screen.queryByText("自动应用")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "切换为手动确认" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-assistant-ui-composer-input"),
    ).toBeInTheDocument();
  });

  it("docks the floating assistant conversation into the editor column", () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        agentSurface="floating"
        from={null}
      />,
    );

    expect(screen.getByLabelText("姓名")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 AI 简历助手" }));
    fireEvent.click(screen.getByRole("button", { name: "停靠到左侧编辑区" }));

    expect(
      screen.getByRole("region", { name: "AI 简历助手对话面板" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "返回表单编辑" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("姓名")).not.toBeInTheDocument();
    expect(screen.queryByText("自动应用")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回表单编辑" }));

    expect(screen.getByLabelText("姓名")).toBeInTheDocument();
  });

  it("uses a solid blue toolbar state when public sharing is enabled", () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic
        initialSlug="public-slug"
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    const shareButton = screen.getByRole("button", { name: "公开分享" });
    expect(shareButton.className).toContain("bg-primary");
    expect(shareButton.className).toContain("text-primary-foreground");
  });

  it("uses a light blue toolbar state while the share popover is open but not enabled", () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    const shareButton = screen.getByRole("button", { name: "公开分享" });
    fireEvent.click(shareButton);

    expect(shareButton.className).toContain("bg-primary/5");
    expect(shareButton.className).toContain("text-primary");
    expect(shareButton.className).not.toContain("text-primary-foreground");
  });

  it("animates title editing without increasing the title input font size", () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重命名" }));

    const input = screen.getByLabelText("简历名称");
    expect(input.className).toContain("animate-in");
    expect(input.className).toContain("text-[0.8rem]");
    expect(input.className).toContain("md:text-[0.8rem]");
    expect(input.className).toContain("focus-visible:ring-0");
  });

  it("【复核发现】改标题会触发一次提交（标题不在表单里，需独立 effect）", async () => {
    /*
     * 真实缺陷：标题是独立的 React state，**不在表单里**，所以 `form.watch` 不会
     * 因为改标题而触发。旧 `use-resume-autosave` 有等价的 title effect，
     * 迁移到统一提交时漏掉了 —— 结果是「改了标题但永远不落盘」（相对旧行为的回归，
     * 实测提交次数 0）。这条测试锁住那个 effect 存在。
     */
    const content = emptyResumeContent();
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={content}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    // 进入标题编辑态（铅笔按钮 aria-label="重命名"），改标题，再去抖超时。
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const input = screen.getByLabelText("简历名称");
    fireEvent.change(input, { target: { value: "新简历名" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
      await Promise.resolve();
    });

    expect(submitResumeMutationMock).toHaveBeenCalled();
    // 提交里必须带 set_title 操作。
    const hasTitleOp = submitResumeMutationMock.mock.calls.some((call) =>
      ((call[0] as { operations: Array<{ kind: string }> }).operations ?? []).some(
        (op) => op.kind === "set_title",
      ),
    );
    expect(hasTitleOp).toBe(true);
  });

  it("shows autosave status details on the save badge", () => {
    vi.setSystemTime(new Date("2026-05-19T11:26:00.000Z"));

    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso="2026-05-19T11:21:00.000Z"
        initialNowIso="2026-05-19T11:26:00.000Z"
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    const badge = screen.getByTestId("autosave-status");
    expect(badge).toHaveTextContent("5分钟前保存");
    expect(badge).toHaveAttribute("title", "当前自动保存状态：5分钟前保存");
    // 重设计后保存状态收成图标:可见文案走 sr-only(textContent 已覆盖),
    // 完整描述通过 title 属性 + hover tooltip 呈现(不常驻 DOM)。
  });

  it("exports the current live preview as a PNG image", async () => {
    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="实习生/钱嘉豪"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    expect(screen.getByRole("button", { name: "导出简历" }).className).toContain("font-bold");

    // Open the export dropdown then click "导出图片"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出简历" }));
    });
    expect(screen.getByRole("button", { name: "下载 PDF" }).className).toContain("whitespace-nowrap");
    expect(screen.getByRole("button", { name: "下载 PDF" }).className).not.toContain("w-full");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出图片" }));
    });

    expect(exportPreviewImageMock).toHaveBeenCalledWith({
      root: screen.getByTestId("resume-export-preview"),
      filename: "实习生/钱嘉豪",
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("图片已导出");
  });

  it.each([
    ["empty string", ""],
    ["invalid string", "not-a-date"],
  ])("does not crash when initialUpdatedAtIso is %s", (_, iso) => {
    // Regression: Next.js 16 dev RSC sometimes loses Date instances through
    // the SC → CC boundary. The editor must tolerate a missing/invalid
    // initial timestamp instead of crashing on `lastSavedAt.getTime()`.
    expect(() =>
      render(
        <EditorClient
          userId="user-a"
          id="r1"
          initialTitle="简历"
          initialTemplate="professional"
          initialContent={emptyResumeContent()}
          initialRevision={0}
          initialIsPublic={false}
          initialSlug={null}
          initialUpdatedAtIso={iso}
          initialNowIso="2026-05-19T11:26:00.000Z"
          initialResolvedTemplate={DB_RESOLVED}
          uploadedTemplates={[]}
          allTemplates={DB_TEMPLATE_ROWS}
        from={null}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("autosave-status")).toBeInTheDocument();
  });

  it("shows an error toast when PNG export fails", async () => {
    exportPreviewImageMock.mockRejectedValueOnce(new Error("boom"));

    render(
      <EditorClient
        userId="user-a"
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialRevision={0}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialNowIso={new Date().toISOString()}
        initialResolvedTemplate={DB_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={DB_TEMPLATE_ROWS}
        from={null}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出简历" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出图片" }));
    });

    expect(toastErrorMock).toHaveBeenCalledWith("图片导出失败，请稍后重试");
    expect(screen.getByRole("button", { name: "导出简历" })).toBeEnabled();
  });
});
