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
