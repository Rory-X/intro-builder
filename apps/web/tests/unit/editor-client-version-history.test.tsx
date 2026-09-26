import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorClient from "@/app/(app)/resume/[id]/edit/editor-client";
import { DEFAULT_STYLE_SETTINGS, emptyResumeContent } from "@intro-builder/shared/schemas";
import type { AllTemplatesItem } from "@/lib/templates/registry";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";
import type { AgentOperationApplyResult } from "@/components/agent/agent-operation-apply";
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
const submitResumeMutationMock = vi.fn();
const setTemplateMock = vi.fn();
const toggleShareMock = vi.fn();
const listResumeVersionsMock = vi.fn();
const getResumeVersionMock = vi.fn();
const submitResumeVersionRestoreMock = vi.fn();
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
  submitResumeVersionRestore: (...args: unknown[]) => submitResumeVersionRestoreMock(...args),
  createResumeVersion: (...args: unknown[]) => createResumeVersionMock(...args),
  /*
   * 编辑器写入已切到提交模块；这里必须提供该导出，否则编辑器在保存时会拿到
   * undefined（表现为「保存永远失败」）。保留 createResumeVersion 是因为
   * Agent 应用路径尚未迁移（P03 任务 4 的剩余部分）。
   */
  submitResumeMutation: (...args: unknown[]) => submitResumeMutationMock(...args),
}));

vi.mock("@/components/agent/agent-panel", () => ({
  AgentPanel: ({
    applyOperation,
    flushAutosave,
  }: {
    applyOperation: (operation: ResumeOperation) => AgentOperationApplyResult | boolean | void;
    flushAutosave: () => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={async () => {
        const result = applyOperation(agentOperation);
        if (result === false) return;
        if (typeof result === "object" && result !== null && "ok" in result && !result.ok) {
          return;
        }
        await flushAutosave();
        if (typeof result === "object" && result !== null && "ok" in result && result.ok) {
          result.commit?.();
        }
      }}
    >
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
    submitResumeMutationMock.mockReset();
    submitResumeMutationMock.mockImplementation(
      async (input: { expectedRevision: number }) => ({
        status: "committed",
        revision: input.expectedRevision + 1,
        versionId: "v-test",
      }),
    );
    setTemplateMock.mockResolvedValue(undefined);
    toggleShareMock.mockResolvedValue({ slug: null });
    listResumeVersionsMock.mockResolvedValue([]);
    getResumeVersionMock.mockResolvedValue(null);
    submitResumeVersionRestoreMock.mockReset();
    submitResumeVersionRestoreMock.mockResolvedValue({
      status: "no_change",
      currentRevision: 0,
    });
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

  it("renders undo, redo and version history as icon-only toolbar buttons", () => {
    renderEditor();

    const toolbar = screen.getByTestId("editor-toolbar");

    for (const label of ["撤销", "重做", "版本历史"]) {
      const button = screen.getByRole("button", { name: label });
      // Icon-only: the accessible name carries the meaning, not visible text.
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }

    // The old text labels must be gone from the toolbar entirely — otherwise the
    // buttons are still consuming the horizontal space this change reclaims.
    expect(toolbar).not.toHaveTextContent("撤销");
    expect(toolbar).not.toHaveTextContent("重做");
    expect(toolbar).not.toHaveTextContent("版本历史");
  });

  it("labels the icon-only toolbar buttons with a tooltip", async () => {
    renderEditor();

    const undoButton = screen.getByRole("button", { name: "撤销" });
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    fireEvent.focus(undoButton);

    // Base UI's tooltip popup exposes no ARIA role in this version, so assert
    // on the rendered slot rather than a role query.
    const tooltip = await waitFor(() => {
      const node = document.querySelector('[data-slot="tooltip-content"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(tooltip).toHaveTextContent("撤销");
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
    submitResumeVersionRestoreMock.mockResolvedValue({
      status: "committed",
      revision: 1,
      versionId: "v-restore",
      nextContent: historical,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderEditor(current);

    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));
    expect(await screen.findByText("版本历史")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /6 月 23 日 · 上午 10:18/ }));

    expect(await screen.findByText("正在查看历史版本，简历内容暂不可编辑")).toBeInTheDocument();
    expect(screen.getByText("正在查看")).toBeInTheDocument();
    expect(screen.getByText("正在查看历史版本，编辑工具已锁定")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "模板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重命名" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));

    await waitFor(() => {
      // 恢复必须携带 revision（并发保护的 CAS 条件），并且只调用一次原子提交接口。
      expect(submitResumeVersionRestoreMock).toHaveBeenCalledTimes(1);
      expect(submitResumeVersionRestoreMock.mock.calls[0][0]).toMatchObject({
        resumeId: "r1",
        versionId: "v1",
        expectedRevision: expect.any(Number),
      });
    });
    expect(screen.getByRole("heading", { name: "王小明" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("正在查看历史版本，简历内容暂不可编辑")).not.toBeInTheDocument();
    });

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

    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /6 月 23 日 · 上午 10:18/ }));
    expect(await screen.findByText("正在查看历史版本，简历内容暂不可编辑")).toBeInTheDocument();

    /*
     * Escape 的处理在 `editor-client.tsx` 的一个 useEffect 里注册，
     * 而那个 effect 的**依赖数组含 `viewedVersion`**。
     *
     * 因此**必须先让 effect 重跑完**，再派发 keydown —— 否则监听器闭包里的
     * `viewedVersion` 还是旧值（null），Escape 会被忽略。
     *
     * `fireEvent.keyDown` 是同步派发，而 React 提交 effect 要等一次调度；
     * 本地机器快、effect 已重跑完因此通过，CI 机器慢就赶不上 ——
     * 这就是这条用例偶发失败（本地单独跑 3 次全过、全量并发时失败）的根因。
     *
     * 我上一轮只给**断言**加了 waitFor，没有处理**派发**的时序，
     * 因此没有修彻底。这里用 act 包住一次微任务排空，确保 effect 已生效。
     */
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("正在查看历史版本，简历内容暂不可编辑")).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("heading", { name: "王小明" })).toBeInTheDocument();
    expect(screen.getAllByText("增长产品经理").length).toBeGreaterThan(0);
  });

  it("creates a durable version when applying an Agent operation", async () => {
    const content = emptyResumeContent();
    content.basics.title = "产品助理";
    renderEditor(content);

    fireEvent.click(screen.getByRole("button", { name: "Agent 模式" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟应用 Agent 修改" }));

    /*
     * Agent 应用后的落盘**只能有一次**（P03 任务 4）。
     *
     * 旧断言锁的是 `createResumeVersion` —— 那条路径绕过 revision、不参与幂等，
     * 而表单变更又会触发一次统一提交，于是同一次操作写两条留痕。
     * 现在断言两件事同时成立：
     * 1. 这次修改确实经统一提交落盘，且携带操作内容；
     * 2. 那条独立的旧留痕入口**不再**被调用。
     */
    await waitFor(() => {
      expect(submitResumeMutationMock).toHaveBeenCalled();
    });
    const agentCall = submitResumeMutationMock.mock.calls.find((call) => {
      const operations = (call[0] as { operations: Array<{ target?: { field?: string } }> }).operations;
      return operations.some((op) => op.target?.field === "title");
    });
    expect(agentCall).toBeDefined();
    expect(createResumeVersionMock).not.toHaveBeenCalled();

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
      expect(submitResumeMutationMock).toHaveBeenCalled();
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

    /*
     * 断言从「调用了 setTemplate action」升级为「以 set_template 语义操作提交」。
     *
     * 这条更强：它同时证明了模板变化走的是**带 revision 的统一提交**，
     * 而不是那条不带并发保护、也不写留痕的旧 action（模板换了正文没换
     * 这类半应用状态正是由旧路径造成的）。
     */
    await waitFor(() => {
      expect(submitResumeMutationMock).toHaveBeenCalled();
    });
    const templateOp = () =>
      submitResumeMutationMock.mock.calls
        .flatMap((call) => (call[0] as { operations: Array<{ kind: string; after?: string }> }).operations)
        .filter((operation) => operation.kind === "set_template")
        .at(-1);
    expect(templateOp()?.after).toBe("modern");
    // 旧的模板写入路径不得再被调用（否则会出现两套写入）。
    expect(setTemplateMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "现代（使用中）" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() => {
      expect(templateOp()?.after).toBe("professional");
    });
    expect(await screen.findByRole("button", { name: "专业（使用中）" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重做" }));

    await waitFor(() => {
      expect(templateOp()?.after).toBe("modern");
    });
    expect(await screen.findByRole("button", { name: "现代（使用中）" })).toBeDisabled();
  });
});
