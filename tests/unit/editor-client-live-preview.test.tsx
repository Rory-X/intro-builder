import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorClient from "@/app/(app)/resume/[id]/edit/editor-client";
import { emptyResumeContent } from "@/lib/resume-schema";

const saveResumeMock = vi.fn();

vi.mock("@/app/(app)/resume/[id]/edit/actions", () => ({
  saveResume: (...args: unknown[]) => saveResumeMock(...args),
  setTemplate: vi.fn(),
  toggleShare: vi.fn(),
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
      />,
    );

    expect(screen.getAllByLabelText("姓名")).toHaveLength(1);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("姓名"), {
        target: { value: "新姓名" },
      });
    });

    expect(screen.getByRole("heading", { name: "新姓名" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    expect(saveResumeMock).toHaveBeenCalled();
    expect(saveResumeMock.mock.calls.at(-1)?.[1].basics.name).toBe("新姓名");
  });
});
