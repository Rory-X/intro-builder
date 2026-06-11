import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { CustomSectionEditor } from "@/components/editor/custom-section-editor";
import { emptyResumeContent, type ResumeContent } from "@intro-builder/shared/schemas";
import { emptyDoc } from "@intro-builder/shared/types";

vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
}));

function Harness() {
  const content = emptyResumeContent();
  content.custom = [{ id: "custom_1", title: "自定义模块", content: emptyDoc() }];
  const form = useForm<ResumeContent>({ defaultValues: content });
  return (
    <FormProvider {...form}>
      <CustomSectionEditor sectionId="custom_1" />
    </FormProvider>
  );
}

describe("CustomSectionEditor", () => {
  it("collapses with grid-row animation instead of unmounting content", () => {
    const { container } = render(<Harness />);

    fireEvent.click(screen.getByText("自定义"));

    const collapsed = container.querySelector(".grid-rows-\\[0fr\\]");
    expect(collapsed).not.toBeNull();
    expect(collapsed).toHaveAttribute("data-section-body-collapsed", "true");
    expect(screen.getByText("模块标题")).toBeInTheDocument();
  });
});
