import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorClient from "@/app/(app)/resume/[id]/edit/editor-client";
import { emptyResumeContent } from "@/lib/resume-schema";
import { TEMPLATES, type AllTemplatesItem } from "@/lib/templates/registry";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

// Built-in default for the now-required template props. Tests don't
// exercise uploaded templates; the dispatcher's built-in branch is the
// right baseline.
const BUILTIN_RESOLVED: SerializableResolvedTemplate = {
  source: "builtin",
  id: "professional",
};

// Built-in projection of the merged template list — picker UI iterates this.
// Uploaded entries are added per-test when needed.
const BUILTIN_TEMPLATES_LIST: AllTemplatesItem[] = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  thumbnailUrl: null,
  source: "builtin",
  isRecommended: t.isRecommended,
  defaultStyleSettings: t.defaultStyleSettings,
  category: t.category,
  tags: t.tags,
}));

const saveResumeMock = vi.fn();
const exportPreviewImageMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/app/(app)/resume/[id]/edit/actions", () => ({
  saveResume: (...args: unknown[]) => saveResumeMock(...args),
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates preview and autosaves changed registered field values", async () => {
    const content = emptyResumeContent();
    content.basics.name = "旧姓名";

    render(
      <EditorClient
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={content}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialResolvedTemplate={BUILTIN_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={BUILTIN_TEMPLATES_LIST}
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

    expect(saveResumeMock).toHaveBeenCalled();
    expect(saveResumeMock.mock.calls.at(-1)?.[1].basics.name).toBe("新姓名");
  });

  it("renders template and layout settings in the toolbar only", () => {
    render(
      <EditorClient
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialResolvedTemplate={BUILTIN_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={BUILTIN_TEMPLATES_LIST}
        from={null}
      />,
    );

    const toolbar = screen.getByTestId("editor-toolbar");
    expect(toolbar).toHaveTextContent("排版");
    expect(screen.getAllByRole("button", { name: "排版" })).toHaveLength(1);
  });

  it("shows autosave status details on the save badge", () => {
    vi.setSystemTime(new Date("2026-05-19T11:26:00.000Z"));

    render(
      <EditorClient
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso="2026-05-19T11:21:00.000Z"
        initialResolvedTemplate={BUILTIN_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={BUILTIN_TEMPLATES_LIST}
        from={null}
      />,
    );

    const badge = screen.getByTestId("autosave-status");
    expect(badge).toHaveTextContent("5分钟前保存");
    expect(badge).toHaveAttribute("title", "当前自动保存状态：5分钟前保存");
    expect(screen.getByText("当前自动保存状态：5分钟前保存")).toBeInTheDocument();
  });

  it("exports the current live preview as a PNG image", async () => {
    render(
      <EditorClient
        id="r1"
        initialTitle="实习生/钱嘉豪"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialResolvedTemplate={BUILTIN_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={BUILTIN_TEMPLATES_LIST}
        from={null}
      />,
    );

    // Open the export dropdown then click "导出图片"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出简历" }));
    });
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
          id="r1"
          initialTitle="简历"
          initialTemplate="professional"
          initialContent={emptyResumeContent()}
          initialIsPublic={false}
          initialSlug={null}
          initialUpdatedAtIso={iso}
          initialResolvedTemplate={BUILTIN_RESOLVED}
          uploadedTemplates={[]}
          allTemplates={BUILTIN_TEMPLATES_LIST}
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
        id="r1"
        initialTitle="简历"
        initialTemplate="professional"
        initialContent={emptyResumeContent()}
        initialIsPublic={false}
        initialSlug={null}
        initialUpdatedAtIso={new Date().toISOString()}
        initialResolvedTemplate={BUILTIN_RESOLVED}
        uploadedTemplates={[]}
        allTemplates={BUILTIN_TEMPLATES_LIST}
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
