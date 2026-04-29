import { describe, it, expect } from "vitest";
import { ResumeContent, emptyResumeContent } from "@/lib/resume-schema";

describe("ResumeContent v2", () => {
  it("accepts empty default skeleton", () => {
    const r = ResumeContent.safeParse(emptyResumeContent());
    expect(r.success).toBe(true);
  });

  it("rejects invalid email in basics", () => {
    const bad = { ...emptyResumeContent() };
    bad.basics.email = "not-an-email";
    expect(ResumeContent.safeParse(bad).success).toBe(false);
  });

  it("requires non-empty name in basics", () => {
    const bad = emptyResumeContent();
    bad.basics.name = "";
    expect(ResumeContent.safeParse(bad).success).toBe(false);
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

  it("defaults photo to empty string", () => {
    const c = emptyResumeContent();
    expect(c.basics.photo).toBe("");
  });
});
