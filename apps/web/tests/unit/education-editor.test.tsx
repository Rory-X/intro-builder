import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { EducationEditor } from "@/components/editor/education-editor";
import { emptyResumeContent, type ResumeContent } from "@/lib/resume-schema";

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
}));

function Harness() {
  const content = emptyResumeContent();
  content.education = [
    {
      school: "广东工业大学",
      degree: "本科 全日制",
      major: "计算机科学与技术",
      location: "广州",
      start: "2023-09",
      end: "2027-07",
      gpa: "",
      highlights: { type: "doc", content: [] },
    },
  ];
  const form = useForm<ResumeContent>({ defaultValues: content });

  return (
    <FormProvider {...form}>
      <EducationEditor />
    </FormProvider>
  );
}

describe("EducationEditor", () => {
  it("uses a full-width school row and renames highlights", () => {
    render(<Harness />);

    expect(screen.getByTestId("education-school-field").className).toContain("col-span-2");
    expect(screen.getByText("城市")).toBeInTheDocument();
    expect(screen.getByText("在校经历/奖项")).toBeInTheDocument();
    expect(screen.queryByText("亮点")).not.toBeInTheDocument();
  });
});
