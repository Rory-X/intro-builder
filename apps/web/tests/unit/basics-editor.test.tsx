import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { BasicsEditor } from "@/components/editor/basics-editor";
import { emptyResumeContent, type ResumeContent } from "@intro-builder/shared/schemas";

function Harness() {
  const form = useForm<ResumeContent>({ defaultValues: emptyResumeContent() });
  return (
    <FormProvider {...form}>
      <BasicsEditor />
    </FormProvider>
  );
}

describe("BasicsEditor", () => {
  it("collapses with grid-row animation instead of unmounting content", () => {
    const { container } = render(<Harness />);

    fireEvent.click(screen.getByText("基础信息"));

    const collapsed = container.querySelector(".grid-rows-\\[0fr\\]");
    expect(collapsed).not.toBeNull();
    expect(screen.getByLabelText("姓名")).toBeInTheDocument();
  });
});
