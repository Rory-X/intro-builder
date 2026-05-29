import { describe, it, expect } from "vitest";
import { ResumeContent, StyleSettings, DEFAULT_STYLE_SETTINGS, emptyResumeContent } from "@/lib/resume-schema";

describe("ResumeContent v2", () => {
  it("accepts empty default skeleton", () => {
    const r = ResumeContent.safeParse(emptyResumeContent());
    expect(r.success).toBe(true);
  });

  it("accepts non-standard email text in basics", () => {
    const c = emptyResumeContent();
    c.basics.email = "not-an-email";
    expect(ResumeContent.safeParse(c).success).toBe(true);
  });

  it("accepts empty name while the user is editing", () => {
    const c = emptyResumeContent();
    c.basics.name = "";
    expect(ResumeContent.safeParse(c).success).toBe(true);
  });

  it("experience uses content (TipTapJSON) not bullets", () => {
    const c = emptyResumeContent();
    c.experience = [{
      company: "Acme",
      title: "Eng",
      start: "2024",
      end: "now",
      location: "",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
    }];
    const r = ResumeContent.safeParse(c);
    expect(r.success).toBe(true);
  });

  it("education and projects include location fields", () => {
    const c = emptyResumeContent();
    c.education = [{
      school: "广东工业大学",
      degree: "本科",
      major: "计算机科学与技术",
      location: "广州",
      start: "2023-09",
      end: "2027-07",
      gpa: "",
      highlights: { type: "doc", content: [] },
    }];
    c.projects = [{
      name: "权限管理系统",
      role: "核心开发",
      location: "广州",
      start: "2025-03",
      end: "2025-06",
      stack: ["Vue3"],
      link: "",
      content: { type: "doc", content: [] },
    }];
    const r = ResumeContent.safeParse(c);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.education[0].location).toBe("广州");
      expect(r.data.projects[0].role).toBe("核心开发");
      expect(r.data.projects[0].location).toBe("广州");
      expect(r.data.projects[0].start).toBe("2025-03");
      expect(r.data.projects[0].end).toBe("2025-06");
    }
  });

  it("preserves rich text font size marks through schema parsing", () => {
    const c = emptyResumeContent();
    c.projects = [{
      name: "P",
      role: "",
      location: "",
      start: "",
      end: "",
      stack: [],
      link: "",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Hello",
                marks: [{ type: "textStyle", attrs: { fontSize: "12px" } }],
              },
            ],
          },
        ],
      },
    }];

    const r = ResumeContent.safeParse(c);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(JSON.stringify(r.data.projects[0].content)).toContain('"fontSize":"12px"');
    }
  });

  it("has sectionOrder with defaults", () => {
    const c = emptyResumeContent();
    expect(c.sectionOrder).toEqual(["basics", "experience", "education", "projects", "skills"]);
  });

  it("accepts photo URL in basics", () => {
    const c = emptyResumeContent();
    c.basics.photo = "https://example.com/photo.jpg";
    const r = ResumeContent.safeParse(c);
    expect(r.success).toBe(true);
  });

  it("accepts personal website domains without a protocol", () => {
    const c = emptyResumeContent();
    c.basics.website = "space.ly57.cn";
    const r = ResumeContent.safeParse(c);
    expect(r.success).toBe(true);
  });

  it("defaults photo to empty string", () => {
    const c = emptyResumeContent();
    expect(c.basics.photo).toBe("");
  });
});

describe("StyleSettings v2 (smart-layout 5-dim)", () => {
  it("DEFAULT_STYLE_SETTINGS includes split heading/body line-height", () => {
    expect(DEFAULT_STYLE_SETTINGS).toEqual({
      fontFamily: "sans",
      fontSize: 13,
      lineHeight: 1.6,
      headingLineHeight: 1.6,
      bodyLineHeight: 1.6,
      pagePadding: 40,
      sectionGap: 16,
      itemGap: 12,
    });
  });

  it("backward compat: legacy styleSettings (without sectionGap/itemGap) parses with defaults filled in", () => {
    // 现存简历的 styleSettings 可能是旧 4 字段形态 — Zod default 必须兜底
    const legacy = { fontFamily: "sans", fontSize: 13, lineHeight: 1.6, pagePadding: 40 };
    const r = StyleSettings.safeParse(legacy);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sectionGap).toBe(16);
      expect(r.data.itemGap).toBe(12);
    }
  });

  it("preprocess migrates legacy lineHeight onto heading/body fields when both missing", () => {
    // Pre-split rows wrote only `lineHeight`. The preprocess must copy the
    // user's adjusted value into the new fields so it doesn't snap back to
    // the 1.6 default after upgrade — that would silently undo their setting.
    const legacy = {
      fontFamily: "sans", fontSize: 13, lineHeight: 1.8,
      pagePadding: 40, sectionGap: 16, itemGap: 12,
    };
    const r = StyleSettings.safeParse(legacy);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.headingLineHeight).toBe(1.8);
      expect(r.data.bodyLineHeight).toBe(1.8);
    }
  });

  it("preprocess does not overwrite explicit heading/body line-height", () => {
    // Rows written by the new editor carry both legacy lineHeight (still in
    // the schema for compat) and the explicit new fields. New fields win.
    const newRow = {
      fontFamily: "sans", fontSize: 13, lineHeight: 1.8,
      headingLineHeight: 1.2, bodyLineHeight: 1.5,
      pagePadding: 40, sectionGap: 16, itemGap: 12,
    };
    const r = StyleSettings.safeParse(newRow);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.headingLineHeight).toBe(1.2);
      expect(r.data.bodyLineHeight).toBe(1.5);
    }
  });

  it("accepts new MIN bounds (8 / 1.05 / 8 / 4 / 2)", () => {
    const r = StyleSettings.safeParse({
      fontFamily: "sans",
      fontSize: 8,
      lineHeight: 1.05,
      pagePadding: 8,
      sectionGap: 4,
      itemGap: 2,
    });
    expect(r.success).toBe(true);
  });

  it("rejects values below new MIN", () => {
    expect(StyleSettings.safeParse({ fontSize: 7, lineHeight: 1.05, pagePadding: 8, sectionGap: 4, itemGap: 2 }).success).toBe(false);
    expect(StyleSettings.safeParse({ fontSize: 8, lineHeight: 1.04, pagePadding: 8, sectionGap: 4, itemGap: 2 }).success).toBe(false);
    expect(StyleSettings.safeParse({ fontSize: 8, lineHeight: 1.05, pagePadding: 7, sectionGap: 4, itemGap: 2 }).success).toBe(false);
    expect(StyleSettings.safeParse({ fontSize: 8, lineHeight: 1.05, pagePadding: 8, sectionGap: 3, itemGap: 2 }).success).toBe(false);
    expect(StyleSettings.safeParse({ fontSize: 8, lineHeight: 1.05, pagePadding: 8, sectionGap: 4, itemGap: 1 }).success).toBe(false);
  });

  it("rejects values above MAX", () => {
    expect(StyleSettings.safeParse({ fontSize: 17, lineHeight: 1.05, pagePadding: 8, sectionGap: 4, itemGap: 2 }).success).toBe(false);
    expect(StyleSettings.safeParse({ fontSize: 8, lineHeight: 1.05, pagePadding: 8, sectionGap: 25, itemGap: 2 }).success).toBe(false);
    expect(StyleSettings.safeParse({ fontSize: 8, lineHeight: 1.05, pagePadding: 8, sectionGap: 4, itemGap: 17 }).success).toBe(false);
  });
});
