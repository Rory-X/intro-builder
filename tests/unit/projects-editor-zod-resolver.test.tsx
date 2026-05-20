import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it, vi } from "vitest";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { emptyResumeContent, ResumeContent } from "@/lib/resume-schema";

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

// Mirror EditorClient's setup: zodResolver + mode "onChange". Regression: a
// previous attempt to write fontSize through this path silently dropped the
// mark because Next 16 server actions reject non-plain ProseMirror attrs.
function Harness({ onReady }: { onReady: (getValues: () => unknown) => void }) {
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
  const form = useForm({
    resolver: zodResolver(ResumeContent),
    defaultValues: content,
    mode: "onChange",
  });
  onReady(() => form.getValues("projects.0.content"));

  return (
    <FormProvider {...form}>
      <ProjectsEditor />
    </FormProvider>
  );
}

describe("ProjectsEditor with zodResolver + onChange validation", () => {
  it("retains the fontSize mark in form values after a font size click", async () => {
    let getProjectContent!: () => unknown;
    render(<Harness onReady={(fn) => { getProjectContent = fn; }} />);

    fireEvent.click(screen.getByRole("button", { name: "12" }));

    await waitFor(() => {
      const json = JSON.stringify(getProjectContent());
      expect(json).toContain('"fontSize":"12px"');
    });
  });
});
