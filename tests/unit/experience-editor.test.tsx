import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { ExperienceEditor } from "@/components/editor/experience-editor";
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
  content.experience = [
    {
      company: "腾讯",
      title: "前端工程师",
      start: "2024-01",
      end: "至今",
      location: "深圳",
      content: { type: "doc", content: [] },
    },
  ];
  const form = useForm<ResumeContent>({ defaultValues: content });

  return (
    <FormProvider {...form}>
      <ExperienceEditor />
    </FormProvider>
  );
}

describe("ExperienceEditor", () => {
  it("renders city field", () => {
    render(<Harness />);

    expect(screen.getByText("城市")).toBeInTheDocument();
  });
});
