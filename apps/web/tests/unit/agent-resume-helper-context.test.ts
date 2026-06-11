import { describe, expect, it } from "vitest";

import { buildResumeHelperContext } from "@/lib/agent/resume-helper-context";
import type { ResumeContent } from "@intro-builder/shared/schemas";

describe("buildResumeHelperContext", () => {
  it("extracts capped plain text from resume content", () => {
    const context = buildResumeHelperContext(validContent(), {
      overall: 68,
      sections: [{ key: "experience", label: "工作经历", score: 7, max: 10 }],
    });

    expect(context).toEqual({
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [{ key: "experience", label: "工作经历", score: 7, max: 10 }],
      },
      sections: expect.arrayContaining([
        {
          key: "experience",
          label: "工作经历 1",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ]),
    });
  });

  it("caps total context plain text to 12000 characters", () => {
    const long = "x".repeat(13_000);
    const content = validContent();
    const context = buildResumeHelperContext(
      {
        ...content,
        basics: { ...content.basics, summary: long },
      },
      { overall: 20, sections: [] },
    );

    const total = context.sections.reduce((sum, section) => sum + section.plainText.length, 0);
    expect(total).toBeLessThanOrEqual(12_000);
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
      summary: "3 年前端开发经验。",
      photo: "",
    },
    experience: [
      {
        company: "示例公司",
        title: "前端开发",
        start: "2023-01",
        end: "",
        location: "上海",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "负责业务系统前端开发，优化页面性能。" }],
            },
          ],
        },
      },
    ],
    education: [],
    projects: [],
    research: [],
    skills: { type: "doc", content: [] },
    summary: { type: "doc", content: [] },
    awards: { type: "doc", content: [] },
    portfolio: { type: "doc", content: [] },
    custom: [],
    sectionOrder: ["basics", "experience", "education", "projects", "skills"],
  };
}
