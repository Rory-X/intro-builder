import { act, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { useResumeAutosave } from "@/hooks/use-resume-autosave";
import { emptyResumeContent, type ResumeContent } from "@intro-builder/shared/schemas";

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

function Harness({ onSave }: { onSave: (content: ResumeContent, title: string) => Promise<void> }) {
  const content = emptyResumeContent();
  content.projects = [
    {
      name: "权限管理系统",
      role: "",
      location: "",
      start: "",
      end: "",
      stack: [],
      link: "",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      },
    },
  ];
  const form = useForm<ResumeContent>({ defaultValues: content });
  useResumeAutosave({
    form,
    resumeId: "r1",
    title: "简历",
    debounceMs: 50,
    onSave,
    onError: vi.fn(),
  });

  return (
    <FormProvider {...form}>
      <ProjectsEditor />
    </FormProvider>
  );
}

describe("ProjectsEditor autosave rich text", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes a font size change end-to-end into the saveResume payload", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSave={onSave} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "12" }));
      await vi.advanceTimersByTimeAsync(50);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalled();
    const lastPayload = JSON.stringify(onSave.mock.calls.at(-1)?.[0].projects[0].content);
    expect(lastPayload).toContain('"fontSize":"0.92em"');
  });
});
