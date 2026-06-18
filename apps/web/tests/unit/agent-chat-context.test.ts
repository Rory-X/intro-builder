import { describe, expect, it } from "vitest";

import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { TipTapJSON } from "@intro-builder/shared/types";

describe("buildAgentResumeContext", () => {
  it("builds capped block summaries with field paths for Agent tools", () => {
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
    expect(context.sectionOrder).toEqual(["basics", "experience", "projects", "education", "skills"]);
    expect(context.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "basics",
          label: "基本信息",
          fieldPath: "basics",
          plainText: expect.stringContaining("姓名：张三"),
        }),
        expect.objectContaining({
          key: "experience",
          label: "工作经历 1",
          fieldPath: "experience.0",
          plainText: expect.stringContaining("公司：示例科技"),
        }),
        expect.objectContaining({
          key: "projects",
          label: "项目经历 1",
          fieldPath: "projects.0",
          plainText: expect.stringContaining("技术栈：React、TypeScript"),
        }),
        expect.objectContaining({
          key: "education",
          label: "教育经历 1",
          fieldPath: "education.0",
          plainText: expect.stringContaining("学校：示例大学"),
        }),
        expect.objectContaining({
          key: "research",
          label: "研究经历 1",
          fieldPath: "research.0",
          plainText: expect.stringContaining("论文：Resume Agents"),
        }),
        expect.objectContaining({
          key: "summary",
          label: "个人总结",
          fieldPath: "summary",
          plainText: "独立负责前端工程化建设。",
        }),
        expect.objectContaining({
          key: "skills",
          label: "技能",
          fieldPath: "skills",
          plainText: "React TypeScript",
        }),
        expect.objectContaining({
          key: "awards",
          label: "荣誉奖项",
          fieldPath: "awards",
          plainText: "国家奖学金",
        }),
        expect.objectContaining({
          key: "portfolio",
          label: "作品集",
          fieldPath: "portfolio",
          plainText: "作品集链接",
        }),
        expect.objectContaining({
          key: "custom",
          label: "开源贡献",
          fieldPath: "custom.custom_1",
          plainText: expect.stringContaining("内容：维护开源项目。"),
        }),
        expect.objectContaining({
          key: "style",
          label: "排版样式",
          fieldPath: "styleSettings",
          plainText: expect.stringContaining("正文字号：12"),
        }),
      ]),
    );
    const basics = context.sections.find((section) => section.fieldPath === "basics")!;
    expect(basics.plainText).toEqual(expect.stringContaining("求职状态：在职"));
    expect(basics.plainText).toEqual(expect.stringContaining("个人简介：3 年前端开发经验，关注工程质量。"));
    const experience = context.sections.find((section) => section.fieldPath === "experience.0")!;
    expect(experience.plainText).toEqual(
      expect.stringContaining("内容：负责后台系统开发，优化页面性能。"),
    );
    const style = context.sections.find((section) => section.fieldPath === "styleSettings")!;
    expect(style.plainText).toEqual(expect.stringContaining("正文行高：1.5"));
  });

  it("keeps empty block fields visible so Agent can fill them", () => {
    const context = buildAgentResumeContext({
      content: {
        ...validContent(),
        basics: {
          ...validContent().basics,
          website: "",
        },
        summary: richText(""),
        awards: richText(""),
        portfolio: richText(""),
      },
      templateId: "professional",
      activeSection: null,
      completeness: { overall: 80, sections: [] },
    });

    expect(context.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "basics",
          plainText: expect.stringContaining("个人链接：未填写"),
        }),
        expect.objectContaining({
          fieldPath: "summary",
          plainText: "未填写",
        }),
        expect.objectContaining({
          fieldPath: "awards",
          plainText: "未填写",
        }),
        expect.objectContaining({
          fieldPath: "portfolio",
          plainText: "未填写",
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
      status: "在职",
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
    education: [
      {
        school: "示例大学",
        degree: "本科",
        major: "计算机科学",
        location: "杭州",
        start: "2020-09",
        end: "2024-06",
        gpa: "3.8/4.0",
        highlights: richText("GPA 前 10%。"),
      },
    ],
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
    research: [
      {
        name: "LLM 简历生成",
        role: "作者",
        location: "",
        start: "2023",
        end: "2024",
        paperTitle: "Resume Agents",
        link: "https://example.com/paper",
        content: richText("分析工具调用可靠性。"),
      },
    ],
    skills: richText("React TypeScript"),
    summary: richText("独立负责前端工程化建设。"),
    awards: richText("国家奖学金"),
    portfolio: richText("作品集链接"),
    custom: [{ id: "custom_1", title: "开源贡献", content: richText("维护开源项目。") }],
    sectionOrder: ["basics", "experience", "projects", "education", "skills"],
    styleSettings: {
      fontFamily: "serif",
      fontSize: 12,
      lineHeight: 1.5,
      bodyLineHeight: 1.5,
      headingGap: 10,
      pagePadding: 36,
      sectionGap: 14,
      itemGap: 8,
      photoScale: 1.1,
    },
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
