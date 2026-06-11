import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useFormContext, useWatch } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { emptyResumeContent, type ResumeContent } from "@intro-builder/shared/schemas";

function NameInput() {
  const { register } = useFormContext<ResumeContent>();
  return <Input aria-label="姓名" {...register("basics.name")} />;
}

function WatchedName() {
  const content = useWatch<ResumeContent>() as ResumeContent;
  return <output aria-label="预览姓名">{content.basics.name}</output>;
}

function Harness() {
  const form = useForm<ResumeContent>({ defaultValues: emptyResumeContent() });
  return (
    <FormProvider {...form}>
      <NameInput />
      <WatchedName />
    </FormProvider>
  );
}

describe("form live preview wiring", () => {
  it("updates a root useWatch preview when a registered input changes", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "钱嘉豪-改" },
    });

    expect(screen.getByLabelText("预览姓名")).toHaveTextContent("钱嘉豪-改");
  });
});
