import { describe, it, expect } from "vitest";
import { ResumeContent, emptyResumeContent } from "@/lib/resume-schema";

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
