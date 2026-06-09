import { describe, expect, it } from "vitest";

import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";

describe("buildAgentResumeContext", () => {
  it("builds capped sections with field paths for Agent tools", () => {
    const context = buildAgentResumeContext({
      content: validContent(),
      templateId: "professional",
      activeSection: null,
      completeness: {
        overall: 80,
        sections: [{ key: "experience", label: "工作经历", score: 18, max: 25 }],
      },
    });

    expect(context.resumeTitle).toBe("前端开发工程师");
    expect(context.templateId).toBe("professional");
    expect(context.activeSection).toBeNull();
    expect(context.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "summary",
          label: "个人总结",
          fieldPath: "basics.summary",
          plainText: "3 年前端开发经验，关注工程质量。",
        }),
        expect.objectContaining({
          key: "experience",
          label: "工作经历 1",
          fieldPath: "experience.0.content",
          plainText: "负责后台系统开发，优化页面性能。",
        }),
        expect.objectContaining({
          key: "projects",
          label: "项目经历 1",
          fieldPath: "projects.0.content",
          plainText: "搭建在线简历编辑器。",
        }),
        expect.objectContaining({
          key: "skills",
          label: "技能",
          fieldPath: "skills",
          plainText: "React TypeScript",
        }),
      ]),
    );
  });

  it("caps total plain text so Agent requests stay bounded", () => {
    const content = {
      ...validContent(),
      basics: {
        ...validContent().basics,
        summary: "很长".repeat(7000),
      },
    };

    const context = buildAgentResumeContext({
      content,
      templateId: "modern",
      activeSection: "summary",
      completeness: { overall: 10, sections: [] },
    });

    const total = context.sections.reduce(
      (sum, section) => sum + section.plainText.length,
      0,
    );
    expect(total).toBeLessThanOrEqual(12_000);
    expect(context.activeSection).toBe("summary");
  });
});

function validContent(): ResumeContent {
  return {
    basics: {
      name: "张三",
      status: "",
      title: "前端开发工程师",
      email: "zhangsan@example.com",
      phone: "13800000000",
      location: "上海",
      website: "",
      summary: "3 年前端开发经验，关注工程质量。",
      photo: "",
    },
    experience: [
      {
        company: "示例科技",
        title: "前端开发",
        start: "2024-01",
        end: "",
        location: "上海",
        content: richText("负责后台系统开发，优化页面性能。"),
      },
    ],
    education: [],
    projects: [
      {
        name: "简历项目",
        role: "负责人",
        location: "",
        start: "",
        end: "",
        stack: ["React", "TypeScript"],
        link: "",
        content: richText("搭建在线简历编辑器。"),
      },
    ],
    research: [],
    skills: richText("React TypeScript"),
    custom: [],
    sectionOrder: ["basics", "experience", "projects", "education", "skills"],
  };
}

function richText(text: string): TipTapJSON {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}
