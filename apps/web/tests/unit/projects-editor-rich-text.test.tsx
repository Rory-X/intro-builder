import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { emptyResumeContent, type ResumeContent } from "@intro-builder/shared/schemas";

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

function Harness({ onReady }: { onReady: (form: UseFormReturn<ResumeContent>) => void }) {
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
  onReady(form);

  return (
    <FormProvider {...form}>
      <ProjectsEditor />
    </FormProvider>
  );
}

describe("ProjectsEditor rich text", () => {
  it("writes toolbar fontSize changes into RHF form values", async () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: "12" }));

    await waitFor(() => {
      const json = JSON.stringify(form.getValues("projects.0.content"));
      expect(json).toContain('"fontSize":"0.92em"');
    });
  });
});
