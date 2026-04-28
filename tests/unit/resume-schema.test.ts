import { describe, it, expect } from "vitest";
import { ResumeContent, emptyResumeContent } from "@/lib/resume-schema";

describe("ResumeContent", () => {
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
});
