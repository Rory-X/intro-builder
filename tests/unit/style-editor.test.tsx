import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { StyleEditor } from "@/components/editor/style-editor";
import { emptyResumeContent, type ResumeContent } from "@/lib/resume-schema";

function Harness({
  onReady,
}: {
  onReady?: (form: UseFormReturn<ResumeContent>) => void;
}) {
  const content = emptyResumeContent();
  content.styleSettings = {
    fontFamily: "sans",
    fontSize: 15,
    lineHeight: 1.6,
    pagePadding: 40,
  };
  const form = useForm<ResumeContent>({ defaultValues: content });
  onReady?.(form);

  return (
    <FormProvider {...form}>
      <StyleEditor />
    </FormProvider>
  );
}

describe("StyleEditor", () => {
  it("line-height dropdown does not overwrite the current font size", () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: "排版" }));
    fireEvent.click(screen.getByRole("button", { name: "行距：1.6" }));
    fireEvent.click(screen.getByRole("button", { name: "行距：1.8" }));

    expect(form.getValues("styleSettings")?.fontSize).toBe(15);
    expect(form.getValues("styleSettings")?.lineHeight).toBe(1.8);
  });

  it("uses dropdown value pickers for font size and page padding", () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: "排版" }));

    fireEvent.click(screen.getByRole("button", { name: "字号：15px" }));
    fireEvent.click(screen.getByRole("button", { name: "字号：12px" }));
    expect(form.getValues("styleSettings")?.fontSize).toBe(12);

    fireEvent.click(screen.getByRole("button", { name: "页边距：40px" }));
    fireEvent.click(screen.getByRole("button", { name: "页边距：55px" }));
    expect(form.getValues("styleSettings")?.pagePadding).toBe(55);
  });
});
