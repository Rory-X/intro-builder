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
      location: "北京",
      start: "2025-01",
      end: "2025-06",
      paperTitle: "LLM Agent Eval Framework",
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
  it("renders research fields in correct order: role, location, dates, paper title, paper link", () => {
    const { container } = render(<Harness />);

    const labels = screen.getAllByText(/^(角色|城市|开始|结束|论文名称|论文链接)$/).map((el) => el.textContent);
    expect(labels).toEqual(["角色", "城市", "开始", "结束", "论文名称", "论文链接"]);
    expect(screen.getByText("论文名称").closest("div")?.className).toContain("col-span-2");
    expect(screen.getByText("论文链接").closest("div")?.className).toContain("col-span-2");
  });
});
