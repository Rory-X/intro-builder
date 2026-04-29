import { describe, it, expect } from "vitest";
import { migrateContent } from "@/lib/migrate-content";

describe("migrateContent", () => {
  it("returns v2 unchanged when content field exists on experience", () => {
    const v2 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "" },
      experience: [{ company: "X", title: "Y", start: "", end: "", location: "", content: { type: "doc", content: [] } }],
      education: [],
      projects: [],
      skills: [],
      custom: [],
      sectionOrder: ["basics"],
    };
    const result = migrateContent(v2);
    expect(result.experience[0].content).toEqual({ type: "doc", content: [] });
  });

  it("migrates v1 bullets to TipTap doc", () => {
    const v1 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "" },
      experience: [{ company: "X", title: "Y", start: "", end: "", location: "", bullets: ["did A", "did B"] }],
      education: [{ school: "S", degree: "", major: "", start: "", end: "", gpa: "", highlights: ["top student"] }],
      projects: [{ name: "P", stack: [], link: "", bullets: ["built it"] }],
      skills: [],
      custom: [],
    };
    const result = migrateContent(v1);
    expect(result.experience[0].content.type).toBe("doc");
    expect(result.experience[0].content.content[0].type).toBe("bulletList");
    expect(result.education[0].highlights.type).toBe("doc");
    expect(result.projects[0].content.type).toBe("doc");
    expect(result.sectionOrder).toBeDefined();
    expect(result.sectionOrder.length).toBeGreaterThan(0);
  });

  it("adds sectionOrder if missing", () => {
    const v1 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "" },
      experience: [],
      education: [],
      projects: [],
      skills: [],
      custom: [],
    };
    const result = migrateContent(v1);
    expect(result.sectionOrder).toEqual(["basics", "experience", "education", "projects", "skills", "custom"]);
  });
});
