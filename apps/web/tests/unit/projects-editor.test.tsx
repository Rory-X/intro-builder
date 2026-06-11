import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { emptyResumeContent, type ResumeContent } from "@intro-builder/shared/schemas";

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
  content.projects = [
    {
      name: "权限管理系统",
      role: "核心开发",
      location: "广州",
      start: "2025-03",
      end: "2025-06",
      stack: ["Vue3"],
      link: "",
      content: { type: "doc", content: [] },
    },
  ];
  const form = useForm<ResumeContent>({ defaultValues: content });

  return (
    <FormProvider {...form}>
      <ProjectsEditor />
    </FormProvider>
  );
}

describe("ProjectsEditor", () => {
  it("renders role and date range fields", () => {
    render(<Harness />);

    expect(screen.getByText("担任角色")).toBeInTheDocument();
    expect(screen.getByText("开始")).toBeInTheDocument();
    expect(screen.getByText("结束")).toBeInTheDocument();
    expect(screen.getByText("项目链接")).toBeInTheDocument();
    expect(screen.getByText("技术栈 (逗号分隔)")).toBeInTheDocument();
  });
});
