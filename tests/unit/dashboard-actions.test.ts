import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(),
    delete: vi.fn(),
    query: { resumes: { findFirst: vi.fn() } },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((u: string) => { throw new Error("REDIRECT:" + u); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// getTemplateMetaAsync is now used to validate templateId before INSERT.
// We mock it here because the real implementation pulls in DB driver code,
// and the test focuses on the action's redirect/insert behavior, not the
// registry resolution semantics (covered separately).
vi.mock("@/lib/templates/registry-server", () => ({
  getTemplateMetaAsync: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { getTemplateMetaAsync } from "@/lib/templates/registry-server";
import { createResume, duplicateResume } from "@/app/(app)/dashboard/actions";

describe("createResume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default-resolve to the built-in "professional" — same id as the
    // pre-validation behavior, so existing test expectations still hold.
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue({
      source: "builtin",
      id: "professional",
      meta: { id: "professional", name: "Professional", description: "", Layout: () => null },
    });
  });

  it("redirects to login when unauthenticated", async () => {
    (auth as unknown as Mock).mockResolvedValue(null);
    await expect(createResume()).rejects.toThrow("REDIRECT:/login");
  });

  it("inserts a resume and redirects to edit", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    const returning = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as unknown as Mock).mockReturnValue({ values });
    await expect(createResume()).rejects.toThrow("REDIRECT:/resume/r1/edit");
    expect(values).toHaveBeenCalled();
    // Validate that the inserted templateId is the resolved one (default).
    expect(values.mock.calls[0]?.[0].templateId).toBe("professional");
  });

  it("duplicates an owned resume and redirects to the copy", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      title: "前端简历",
      templateId: "modern",
      content: { basics: { name: "A" } },
    });
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue({
      source: "builtin",
      id: "modern",
      meta: { id: "modern", name: "Modern", description: "", Layout: () => null },
    });
    const returning = vi.fn().mockResolvedValue([{ id: "r-copy" }]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as unknown as Mock).mockReturnValue({ values });

    await expect(duplicateResume("r1")).rejects.toThrow("REDIRECT:/resume/r-copy/edit");

    expect(db.query.resumes.findFirst).toHaveBeenCalled();
    expect(getTemplateMetaAsync).toHaveBeenCalledWith("modern");
    expect(values).toHaveBeenCalledWith({
      userId: "u1",
      title: "前端简历 (副本)",
      templateId: "modern",
      content: { basics: { name: "A" } },
    });
  });

  it("falls back to default when duplicating a resume whose templateId is unresolvable", async () => {
    // Source resume points at an uploaded template that has since been
    // deleted; getTemplateMetaAsync returns the default fallback. The
    // duplicate must persist the fallback id, not the broken one.
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      title: "旧简历",
      templateId: "deleted-uploaded-id",
      content: { basics: { name: "B" } },
    });
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue({
      source: "builtin",
      id: "professional",
      meta: { id: "professional", name: "Professional", description: "", Layout: () => null },
    });
    const returning = vi.fn().mockResolvedValue([{ id: "r-copy" }]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as unknown as Mock).mockReturnValue({ values });

    await expect(duplicateResume("r1")).rejects.toThrow("REDIRECT:/resume/r-copy/edit");

    expect(values).toHaveBeenCalledWith({
      userId: "u1",
      title: "旧简历 (副本)",
      templateId: "professional",
      content: { basics: { name: "B" } },
    });
  });

  it("redirects to dashboard when duplicate source is missing", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue(null);

    await expect(duplicateResume("missing")).rejects.toThrow("REDIRECT:/dashboard");
  });
});
