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
    bodyLineHeight: 1.6,
    headingGap: 8,
    pagePadding: 40,
    sectionGap: 16,
    itemGap: 12, photoScale: 1,
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
  it("body line-height dropdown does not overwrite the current font size", () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: "排版" }));
    fireEvent.click(screen.getByRole("button", { name: "正文行距：1.6" }));
    fireEvent.click(screen.getByRole("button", { name: "正文行距：1.8" }));

    expect(form.getValues("styleSettings")?.fontSize).toBe(15);
    expect(form.getValues("styleSettings")?.bodyLineHeight).toBe(1.8);
  });

  it("uses the solid blue toolbar state while the panel is open", () => {
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "排版" });
    fireEvent.click(trigger);

    expect(trigger.className).toContain("bg-primary/5");
    expect(trigger.className).toContain("font-semibold");
    expect(trigger.className).toContain("text-primary");
    expect(trigger.className).toContain("aria-expanded:!bg-primary/5");
    expect(trigger.className).toContain("aria-expanded:!text-primary");
    expect(trigger.className).not.toContain("text-primary-foreground");
  });

  it("section title gap and body line-height are independent", () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: "排版" }));

    // Adjust section gap first; body line-height and same-section heading gap should remain unchanged.
    fireEvent.click(screen.getByRole("button", { name: "标题间距：16px" }));
    fireEvent.click(screen.getByRole("button", { name: "标题间距：20px" }));
    expect(form.getValues("styleSettings")?.sectionGap).toBe(20);
    expect(form.getValues("styleSettings")?.headingGap).toBe(8);
    expect(form.getValues("styleSettings")?.bodyLineHeight).toBe(1.6);

    // Then adjust body; section gap and same-section heading gap should keep their values.
    fireEvent.click(screen.getByRole("button", { name: "正文行距：1.6" }));
    fireEvent.click(screen.getByRole("button", { name: "正文行距：1.9" }));
    expect(form.getValues("styleSettings")?.sectionGap).toBe(20);
    expect(form.getValues("styleSettings")?.headingGap).toBe(8);
    expect(form.getValues("styleSettings")?.bodyLineHeight).toBe(1.9);
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
