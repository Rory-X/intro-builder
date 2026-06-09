import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { ResearchEditor } from "@/components/editor/research-editor";
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
  content.research = [
    {
      name: "大模型 Agent 评估",
      role: "第一作者",
      start: "2025-01",
      end: "2025-06",
      link: "https://example.com/paper",
      content: { type: "doc", content: [] },
    },
  ];
  const form = useForm<ResumeContent>({ defaultValues: content });

  return (
    <FormProvider {...form}>
      <ResearchEditor />
    </FormProvider>
  );
}

describe("ResearchEditor", () => {
  it("places paper link in the half-width metadata grid after role", () => {
    const { container } = render(<Harness />);

    const labels = screen.getAllByText(/^(角色|论文链接|开始|结束)$/).map((el) => el.textContent);
    expect(labels).toEqual(["角色", "论文链接", "开始", "结束"]);
    expect(screen.getByText("论文链接").closest("div")?.className).not.toContain("col-span-2");
    expect(container.querySelector(".grid.grid-cols-2")?.textContent).toContain("角色论文链接开始结束");
  });
});
