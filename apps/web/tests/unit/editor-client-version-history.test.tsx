import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorClient from "@/app/(app)/resume/[id]/edit/editor-client";
import { DEFAULT_STYLE_SETTINGS, emptyResumeContent } from "@intro-builder/shared/schemas";
import type { AllTemplatesItem } from "@/lib/templates/registry";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";
import type { ResumeOperation } from "@intro-builder/shared/types";

const DB_RESOLVED: SerializableResolvedTemplate = {
  source: "unified",
  id: "professional",
  html: '<article><h1><slot data-bind="basic.name"></slot></h1><p><slot data-bind="basic.title"></slot></p><slot data-bind="sectionOrder" data-template="section"></slot></article><template id="section-block"><section><slot data-bind="section.body"></slot></section></template><template id="section-list"><section><slot data-bind="section.items" data-template="item"></slot></section></template><template id="item"><div><slot data-bind="item.title"></slot></div></template>',
  css: null,
  templateId: "professional",
  sectionIcons: {},
};

const MODERN_RESOLVED: SerializableResolvedTemplate = {
  source: "unified",
  id: "modern",
  html: '<article><h1><slot data-bind="basic.name"></slot></h1><p><slot data-bind="basic.title"></slot></p></article>',
  css: null,
  templateId: "modern",
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
];

const TWO_TEMPLATE_ROWS: AllTemplatesItem[] = [
  ...DB_TEMPLATE_ROWS,
  {
    id: "modern",
    name: "现代",
    description: "清爽双栏",
    thumbnailUrl: null,
    source: "uploaded",
    defaultStyleSettings: DEFAULT_STYLE_SETTINGS,
    category: "tech",
  },
];

const UPLOADED_TEMPLATES: UploadedTemplate[] = [
  {
    id: "professional",
    name: "专业",
    description: "单栏清晰",
    thumbnailUrl: null,
    sectionIcons: {},
    html: DB_RESOLVED.html,
    css: null,
    category: "tech",
    features: ["清晰结构", "适合技术岗", "打印友好"],
  },
  {
    id: "modern",
    name: "现代",
    description: "清爽双栏",
    thumbnailUrl: null,
    sectionIcons: {},
    html: MODERN_RESOLVED.html,
    css: null,
    category: "tech",
    features: ["现代排版", "重点突出", "适合投递"],
  },
];

const saveResumeMock = vi.fn();
const setTemplateMock = vi.fn();
const toggleShareMock = vi.fn();
const listResumeVersionsMock = vi.fn();
const getResumeVersionMock = vi.fn();
const restoreResumeVersionMock = vi.fn();
const createResumeVersionMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const AGENT_VERSION_CREATED_AT = "2026-06-25T03:18:00.000Z";

const agentOperation: ResumeOperation = {
  id: "op_1",
  toolCallId: "tool_1",
  label: "更新求职方向",
  section: "basics",
  fieldPath: "basics.title",
  operation: "update_section",
  beforePlainText: "产品助理",
  afterPlainText: "增长产品经理",
  changeSummary: "强化岗位方向",
  riskFlags: [],
};

vi.mock("@/app/(app)/resume/[id]/edit/actions", () => ({
  saveResume: (...args: unknown[]) => saveResumeMock(...args),
  setTemplate: (...args: unknown[]) => setTemplateMock(...args),
  toggleShare: (...args: unknown[]) => toggleShareMock(...args),
  listResumeVersions: (...args: unknown[]) => listResumeVersionsMock(...args),
  getResumeVersion: (...args: unknown[]) => getResumeVersionMock(...args),
  restoreResumeVersion: (...args: unknown[]) => restoreResumeVersionMock(...args),
  createResumeVersion: (...args: unknown[]) => createResumeVersionMock(...args),
}));

vi.mock("@/components/agent/agent-panel", () => ({
  AgentPanel: ({ applyOperation }: { applyOperation: (operation: ResumeOperation) => void }) => (
    <button type="button" onClick={() => applyOperation(agentOperation)}>
      模拟应用 Agent 修改
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/client/export-preview-image", () => ({
  exportPreviewImage: vi.fn(),
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

function renderEditor(
  content = emptyResumeContent(),
  options: {
    uploadedTemplates?: UploadedTemplate[];
    allTemplates?: AllTemplatesItem[];
    favoritedTemplateIds?: string[];
  } = {},
) {
  return render(
    <EditorClient
      id="r1"
      initialTitle="简历"
      initialTemplate="professional"
      initialContent={content}
      initialIsPublic={false}
      initialSlug={null}
      initialUpdatedAtIso={new Date().toISOString()}
      initialNowIso={new Date().toISOString()}
      initialResolvedTemplate={DB_RESOLVED}
      uploadedTemplates={options.uploadedTemplates ?? []}
      allTemplates={options.allTemplates ?? DB_TEMPLATE_ROWS}
      favoritedTemplateIds={options.favoritedTemplateIds ?? []}
      from={null}
    />,
  );
}

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = "";
  thresholds = [];
}

describe("EditorClient version history and undo/redo", () => {
  beforeEach(() => {
    saveResumeMock.mockResolvedValue(undefined);
    setTemplateMock.mockResolvedValue(undefined);
    toggleShareMock.mockResolvedValue({ slug: null });
    listResumeVersionsMock.mockResolvedValue([]);
    getResumeVersionMock.mockResolvedValue(null);
    restoreResumeVersionMock.mockResolvedValue(null);
    createResumeVersionMock.mockResolvedValue({
      id: "v-agent",
      resumeId: "r1",
      source: "agent",
      sourceLabel: "通过对话",
      actorName: "Mem",
      operationCount: 1,
      summary: "强化岗位方向",
      createdAt: AGENT_VERSION_CREATED_AT,
    });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() { return 800; },
    });
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    global.IntersectionObserver = MockObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("undoes and redoes normal editor field changes from the toolbar", async () => {
    const content = emptyResumeContent();
    content.basics.name = "旧姓名";
    renderEditor(content);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("姓名"), {
        target: { value: "新姓名" },
      });
    });
    expect(screen.getByRole("heading", { name: "新姓名" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("heading", { name: "旧姓名" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByRole("heading", { name: "新姓名" })).toBeInTheDocument();
  });

  it("opens version history, enters Diff View, and restores a selected version", async () => {
    const current = emptyResumeContent();
    current.basics.name = "王小明";
    current.basics.title = "增长产品经理";
    const historical = emptyResumeContent();
    historical.basics.name = "王小明";
    historical.basics.title = "产品助理";
    const version: ResumeVersionListItem = {
      id: "v1",
      resumeId: "r1",
      source: "agent",
      sourceLabel: "通过对话",
      actorName: "Mem",
      operationCount: 1,
      summary: "AI 修改",
      createdAt: "2026-06-23T02:18:00.000Z",
    };
    listResumeVersionsMock.mockResolvedValue([version]);
    getResumeVersionMock.mockResolvedValue({
      id: "v1",
      title: "历史简历",
      templateId: "professional",
      content: historical,
      createdAt: version.createdAt,
    });
    restoreResumeVersionMock.mockResolvedValue({
      title: "历史简历",
      templateId: "professional",
      content: historical,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderEditor(current);

    fireEvent.click(screen.getByRole("button", { name: "版本" }));
    expect(await screen.findByText("版本历史")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /6 月 23 日 · 上午 10:18/ }));

    expect(await screen.findByText("正在查看历史版本，简历内容暂不可编辑")).toBeInTheDocument();
    expect(screen.getByText("正在查看")).toBeInTheDocument();
    expect(screen.getByText("正在查看历史版本，编辑工具已锁定")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "模板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重命名" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));

    await waitFor(() => {
      expect(restoreResumeVersionMock).toHaveBeenCalledWith("r1", "v1");
    });
    expect(screen.getByRole("heading", { name: "王小明" })).toBeInTheDocument();
    expect(screen.queryByText("正在查看历史版本，简历内容暂不可编辑")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getAllByText("增长产品经理").length).toBeGreaterThan(0);
  });

  it("exits Diff View with Esc without changing editor content", async () => {
    const current = emptyResumeContent();
    current.basics.name = "王小明";
    current.basics.title = "增长产品经理";
    const historical = emptyResumeContent();
    historical.basics.name = "王小明";
    historical.basics.title = "产品助理";
    const version: ResumeVersionListItem = {
      id: "v1",
      resumeId: "r1",
      source: "agent",
      sourceLabel: "通过对话",
      actorName: "Mem",
      operationCount: 1,
      summary: "AI 修改",
      createdAt: "2026-06-23T02:18:00.000Z",
    };
    listResumeVersionsMock.mockResolvedValue([version]);
    getResumeVersionMock.mockResolvedValue({
      id: "v1",
      title: "历史简历",
      templateId: "professional",
      content: historical,
      createdAt: version.createdAt,
    });

    renderEditor(current);

    fireEvent.click(screen.getByRole("button", { name: "版本" }));
    fireEvent.click(await screen.findByRole("button", { name: /6 月 23 日 · 上午 10:18/ }));
    expect(await screen.findByText("正在查看历史版本，简历内容暂不可编辑")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByText("正在查看历史版本，简历内容暂不可编辑")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "王小明" })).toBeInTheDocument();
    expect(screen.getAllByText("增长产品经理").length).toBeGreaterThan(0);
  });

  it("creates a durable version when applying an Agent operation", async () => {
    const content = emptyResumeContent();
    content.basics.title = "产品助理";
    renderEditor(content);

    fireEvent.click(screen.getByRole("button", { name: "Agent 模式" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟应用 Agent 修改" }));

    await waitFor(() => {
      expect(createResumeVersionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeId: "r1",
          title: "简历",
          templateId: "professional",
          source: "agent",
          operationCount: 1,
          summary: "强化岗位方向",
        }),
      );
    });
    expect(createResumeVersionMock.mock.calls[0][0].content.basics.title).toBe("产品助理");
    const successCall = toastSuccessMock.mock.calls.find(
      ([message]) => message === "已生成版本，可查看对比",
    );
    expect(successCall?.[1]).toMatchObject({
      action: {
        label: "查看差异",
      },
    });

    await act(async () => {
      successCall?.[1]?.action.onClick();
    });

    expect(await screen.findByText("正在查看历史版本，简历内容暂不可编辑")).toBeInTheDocument();
    expect(screen.getByText("产品助理")).toHaveAttribute("data-diff-token", "removed");
    expect(screen.getByText("增长产品经理")).toHaveAttribute("data-diff-token", "added");
  });

  it("undoes and redoes an applied Agent operation", async () => {
    const content = emptyResumeContent();
    content.basics.title = "产品助理";
    renderEditor(content);

    fireEvent.click(screen.getByRole("button", { name: "Agent 模式" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟应用 Agent 修改" }));

    await waitFor(() => {
      expect(createResumeVersionMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getAllByText("产品助理").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getAllByText("增长产品经理").length).toBeGreaterThan(0);
  });

  it("undoes and redoes template switches as discrete editor history steps", async () => {
    renderEditor(emptyResumeContent(), {
      uploadedTemplates: UPLOADED_TEMPLATES,
      allTemplates: TWO_TEMPLATE_ROWS,
      favoritedTemplateIds: ["professional", "modern"],
    });

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    fireEvent.click(await screen.findByRole("button", { name: "套用模板 现代" }));

    await waitFor(() => {
      expect(setTemplateMock).toHaveBeenCalledWith("r1", "modern");
    });
    expect(await screen.findByRole("button", { name: "现代（使用中）" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() => {
      expect(setTemplateMock).toHaveBeenCalledWith("r1", "professional", {
        resetStyleSettings: false,
      });
    });
    expect(await screen.findByRole("button", { name: "专业（使用中）" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重做" }));

    await waitFor(() => {
      expect(setTemplateMock).toHaveBeenCalledWith("r1", "modern", {
        resetStyleSettings: false,
      });
    });
    expect(await screen.findByRole("button", { name: "现代（使用中）" })).toBeDisabled();
  });
});
