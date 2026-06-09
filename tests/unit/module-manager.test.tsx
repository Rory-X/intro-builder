import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { ModuleManager } from "@/components/editor/module-manager";
import { emptyResumeContent, type ResumeContent } from "@/lib/resume-schema";

vi.mock("motion/react", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Reorder: {
      Group: ({
        children,
        onReorder,
        values,
      }: {
        children: React.ReactNode;
        onReorder: (values: string[]) => void;
        values: string[];
      }) => (
        <div>
          <button type="button" onClick={() => onReorder([...values].reverse())}>
            模拟拖动重排
          </button>
          {children}
        </div>
      ),
      Item: ({
        children,
        onDragEnd,
        value,
      }: {
        children: React.ReactNode;
        onDragEnd?: () => void;
        value: string;
      }) => (
        <div>
          {children}
          <button type="button" onClick={onDragEnd}>
            结束拖动 {value}
          </button>
        </div>
      ),
    },
  };
});

function Harness({ onOrderChange = vi.fn() }: { onOrderChange?: (next: string[]) => void }) {
  const form = useForm<ResumeContent>({ defaultValues: emptyResumeContent() });
  return (
    <FormProvider {...form}>
      <ModuleManager
        sectionOrder={["basics", "experience", "education"]}
        onOrderChange={onOrderChange}
      />
    </FormProvider>
  );
}

describe("ModuleManager", () => {
  it("uses the solid blue toolbar state while the panel is open", () => {
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "模块管理" });
    fireEvent.click(trigger);

    expect(trigger.className).toContain("bg-primary/5");
    expect(trigger.className).toContain("font-semibold");
    expect(trigger.className).toContain("text-primary");
    expect(trigger.className).toContain("aria-expanded:!bg-primary/5");
    expect(trigger.className).toContain("aria-expanded:!text-primary");
    expect(trigger.className).not.toContain("text-primary-foreground");
  });

  it("keeps module reorder local until drag end", () => {
    const onOrderChange = vi.fn();
    render(<Harness onOrderChange={onOrderChange} />);

    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟拖动重排" }));

    expect(onOrderChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "结束拖动 education" }));

    expect(onOrderChange).toHaveBeenCalledWith(["basics", "education", "experience"]);
  });
});
