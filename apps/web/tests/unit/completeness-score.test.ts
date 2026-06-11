import { describe, expect, it } from "vitest";
import {
  computeCompletenessScore,
} from "@/lib/completeness-score";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
import { emptyDoc } from "@intro-builder/shared/types";

/** Helper: create a TipTap doc with actual text content */
function filledDoc() {
  return {
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Some content here" }] },
    ],
  };
}

/** Helper: build a full resume with all fields populated */
function fullResume(): ResumeContent {
  return {
    basics: {
      name: "张三",
      status: "",
      title: "前端工程师",
      email: "zhangsan@example.com",
      phone: "13800138000",
      location: "北京",
      website: "https://example.com",
      summary: "资深前端开发",
      photo: "https://example.com/photo.jpg",
    },
    experience: [
      {
        company: "字节跳动",
        title: "高级前端",
        start: "2022-03",
        end: "2024-01",
        location: "北京",
        content: filledDoc(),
      },
    ],
    education: [
      {
        school: "清华大学",
        degree: "硕士",
        major: "计算机科学",
        location: "北京",
        start: "2018-09",
        end: "2022-06",
        gpa: "3.9",
        highlights: filledDoc(),
      },
    ],
    projects: [
      {
        name: "开源项目",
        role: "核心开发者",
        location: "",
        start: "2023-01",
        end: "2023-06",
        stack: ["React", "TypeScript"],
        link: "https://github.com/example",
        content: filledDoc(),
      },
    ],
    research: [],
    skills: {
      type: "doc",
      content: [
        { type: "paragraph", content: [
          { type: "text", marks: [{ type: "bold" }], text: "前端：" },
          { type: "text", text: "React、TypeScript、Vue" },
        ]},
        { type: "paragraph", content: [
          { type: "text", marks: [{ type: "bold" }], text: "工具：" },
          { type: "text", text: "Git、Docker" },
        ]},
      ],
    },
    summary: emptyDoc(),
    awards: emptyDoc(),
    portfolio: emptyDoc(),
    custom: [],
    sectionOrder: ["basics", "experience", "education", "projects", "skills"],
  };
}

describe("computeCompletenessScore", () => {
  it("returns near-zero for an empty resume", () => {
    const empty = emptyResumeContent();
    const result = computeCompletenessScore(empty);

    // Empty resume still has placeholder name/title/email from emptyResumeContent
    // but experience/education/projects/skills are all empty arrays → 0
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThan(30);
    expect(result.sections).toHaveLength(5);
  });

  it("returns 100 for a fully filled resume", () => {
    const result = computeCompletenessScore(fullResume());
    expect(result.overall).toBe(100);
  });

  it("scores basics correctly with only required fields", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      basics: {
        name: "张三",
        status: "",
        title: "工程师",
        email: "test@test.com",
        phone: "13800000000",
        location: "",
        website: "",
        summary: "",
        photo: "",
      },
    };
    const result = computeCompletenessScore(content);
    const basicsSection = result.sections.find((s) => s.key === "basics")!;

    // 4 required fields filled (name, title, email, phone) → 8/10 base
    // No optional fields → 0 bonus
    expect(basicsSection.score).toBe(8);
    expect(basicsSection.max).toBe(10);
  });

  it("gives full basics score with all fields filled", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      basics: {
        name: "张三",
        status: "",
        title: "工程师",
        email: "test@test.com",
        phone: "13800000000",
        location: "上海",
        website: "https://test.com",
        summary: "资深工程师",
        photo: "https://photo.jpg",
      },
    };
    const result = computeCompletenessScore(content);
    const basicsSection = result.sections.find((s) => s.key === "basics")!;
    expect(basicsSection.score).toBe(10);
  });

  it("scores experience = 0 when no items", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      experience: [],
    };
    const result = computeCompletenessScore(content);
    const expSection = result.sections.find((s) => s.key === "experience")!;
    expect(expSection.score).toBe(0);
  });

  it("scores experience based on field fill rate", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      experience: [
        {
          company: "公司A",
          title: "工程师",
          start: "2022-01",
          end: "",
          location: "",
          content: emptyDoc(),
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const expSection = result.sections.find((s) => s.key === "experience")!;

    // Required: company, title, start, content(filled). Only 3/4 required filled (content is empty)
    expect(expSection.score).toBeGreaterThan(0);
    expect(expSection.score).toBeLessThan(10);
  });

  it("scores experience with filled content correctly", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      experience: [
        {
          company: "公司A",
          title: "工程师",
          start: "2022-01",
          end: "2023-01",
          location: "北京",
          content: filledDoc(),
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const expSection = result.sections.find((s) => s.key === "experience")!;
    expect(expSection.score).toBe(10);
  });

  it("averages scores across multiple experience items", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      experience: [
        {
          company: "公司A",
          title: "工程师",
          start: "2022-01",
          end: "2023-01",
          location: "北京",
          content: filledDoc(),
        },
        {
          company: "公司B",
          title: "",
          start: "",
          end: "",
          location: "",
          content: emptyDoc(),
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const expSection = result.sections.find((s) => s.key === "experience")!;

    // First item: fully filled = 10, Second item: only company = partial
    expect(expSection.score).toBeGreaterThan(2);
    expect(expSection.score).toBeLessThan(8);
  });

  it("scores education = 0 when no items", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      education: [],
    };
    const result = computeCompletenessScore(content);
    const eduSection = result.sections.find((s) => s.key === "education")!;
    expect(eduSection.score).toBe(0);
  });

  it("scores education based on required fields", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      education: [
        {
          school: "清华大学",
          degree: "本科",
          major: "CS",
          location: "",
          start: "2018-09",
          end: "",
          gpa: "",
          highlights: emptyDoc(),
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const eduSection = result.sections.find((s) => s.key === "education")!;

    // school + degree + major + start filled = all required → 10
    expect(eduSection.score).toBe(10);
  });

  it("scores projects = 0 when no items", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      projects: [],
    };
    const result = computeCompletenessScore(content);
    const projSection = result.sections.find((s) => s.key === "projects")!;
    expect(projSection.score).toBe(0);
  });

  it("scores projects based on required fields", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      projects: [
        {
          name: "项目A",
          role: "开发者",
          location: "",
          start: "",
          end: "",
          stack: [],
          link: "",
          content: filledDoc(),
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const projSection = result.sections.find((s) => s.key === "projects")!;

    // name + role + content = all 3 required filled → 10
    expect(projSection.score).toBe(10);
  });

  it("scores skills = 0 when empty doc", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      skills: emptyDoc(),
    };
    const result = computeCompletenessScore(content);
    const skillsSection = result.sections.find((s) => s.key === "skills")!;
    expect(skillsSection.score).toBe(0);
  });

  it("scores skills = 10 when has content", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      skills: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "React、Vue" }] },
        ],
      },
    };
    const result = computeCompletenessScore(content);
    const skillsSection = result.sections.find((s) => s.key === "skills")!;

    expect(skillsSection.score).toBe(10);
  });

  it("detects TipTap empty doc as unfilled", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      experience: [
        {
          company: "公司",
          title: "工程师",
          start: "2022-01",
          end: "2023-01",
          location: "",
          content: emptyDoc(),
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const expSection = result.sections.find((s) => s.key === "experience")!;
    // content is empty → 3/4 required fields filled
    expect(expSection.score).toBeLessThan(10);
  });

  it("detects TipTap doc with only empty paragraph as unfilled", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      experience: [
        {
          company: "公司",
          title: "工程师",
          start: "2022-01",
          end: "2023-01",
          location: "",
          content: { type: "doc", content: [{ type: "paragraph" }] },
        },
      ],
    };
    const result = computeCompletenessScore(content);
    const expSection = result.sections.find((s) => s.key === "experience")!;
    expect(expSection.score).toBeLessThan(10);
  });

  it("returns section labels in Chinese", () => {
    const result = computeCompletenessScore(emptyResumeContent());
    const labels = result.sections.map((s) => s.label);
    expect(labels).toContain("基本信息");
    expect(labels).toContain("工作经历");
    expect(labels).toContain("教育经历");
    expect(labels).toContain("项目经历");
    expect(labels).toContain("专业技能");
  });

  it("overall is a rounded integer between 0 and 100", () => {
    const result = computeCompletenessScore(emptyResumeContent());
    expect(Number.isInteger(result.overall)).toBe(true);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  // ─── Custom section tests ──────────────────────────────

  it("includes custom sections in the score breakdown", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "awards", title: "荣誉奖项", content: filledDoc() },
      ],
    };
    const result = computeCompletenessScore(content);

    // Should have 5 built-in + 1 custom = 6 sections
    expect(result.sections).toHaveLength(6);
    const awardsSection = result.sections.find((s) => s.key === "awards")!;
    expect(awardsSection).toBeDefined();
    expect(awardsSection.label).toBe("荣誉奖项");
    expect(awardsSection.score).toBe(10); // title + content both filled
  });

  it("scores custom section with title + content as 10/10", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "summary", title: "个人总结", content: filledDoc() },
      ],
    };
    const result = computeCompletenessScore(content);
    const summarySection = result.sections.find((s) => s.key === "summary")!;
    expect(summarySection.score).toBe(10);
    expect(summarySection.max).toBe(10);
  });

  it("scores custom section with only title as 5/10", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "awards", title: "荣誉奖项", content: emptyDoc() },
      ],
    };
    const result = computeCompletenessScore(content);
    const awardsSection = result.sections.find((s) => s.key === "awards")!;
    expect(awardsSection.score).toBe(5);
  });

  it("scores custom section with only content as 5/10", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "custom-1", title: "", content: filledDoc() },
      ],
    };
    const result = computeCompletenessScore(content);
    const customSection = result.sections.find((s) => s.key === "custom-1")!;
    expect(customSection.score).toBe(5);
  });

  it("scores empty custom section as 0/10", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "awards", title: "", content: emptyDoc() },
      ],
    };
    const result = computeCompletenessScore(content);
    const awardsSection = result.sections.find((s) => s.key === "awards")!;
    expect(awardsSection.score).toBe(0);
  });

  it("custom sections reduce built-in weight proportionally", () => {
    // A full resume without custom → 100
    const full = fullResume();
    const resultNoCustom = computeCompletenessScore(full);
    expect(resultNoCustom.overall).toBe(100);

    // Same full resume with one filled custom → still 100
    const fullWithCustom: ResumeContent = {
      ...full,
      custom: [{ id: "awards", title: "荣誉奖项", content: filledDoc() }],
    };
    const resultWithCustom = computeCompletenessScore(fullWithCustom);
    expect(resultWithCustom.overall).toBe(100);
  });

  it("empty custom section lowers overall score", () => {
    const full = fullResume();
    const resultFull = computeCompletenessScore(full);

    // Add an empty custom section → overall should drop
    const withEmptyCustom: ResumeContent = {
      ...full,
      custom: [{ id: "awards", title: "", content: emptyDoc() }],
    };
    const resultWithEmpty = computeCompletenessScore(withEmptyCustom);
    expect(resultWithEmpty.overall).toBeLessThan(resultFull.overall);
  });

  it("uses section title as label for custom sections", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "custom-xyz", title: "我的自定义模块", content: filledDoc() },
      ],
    };
    const result = computeCompletenessScore(content);
    const customSection = result.sections.find((s) => s.key === "custom-xyz")!;
    expect(customSection.label).toBe("我的自定义模块");
  });

  it("falls back to known module name if title is empty", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "awards", title: "", content: filledDoc() },
      ],
    };
    const result = computeCompletenessScore(content);
    const awardsSection = result.sections.find((s) => s.key === "awards")!;
    expect(awardsSection.label).toBe("荣誉奖项");
  });

  it("handles multiple custom sections", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      custom: [
        { id: "awards", title: "荣誉奖项", content: filledDoc() },
        { id: "research", title: "研究经历", content: filledDoc() },
        { id: "portfolio", title: "作品集", content: emptyDoc() },
      ],
    };
    const result = computeCompletenessScore(content);

    // 5 built-in + 3 custom = 8 sections
    expect(result.sections).toHaveLength(8);

    const awards = result.sections.find((s) => s.key === "awards")!;
    const research = result.sections.find((s) => s.key === "research")!;
    const portfolio = result.sections.find((s) => s.key === "portfolio")!;

    expect(awards.score).toBe(10);
    expect(research.score).toBe(10);
    expect(portfolio.score).toBe(5); // title only
  });
});
