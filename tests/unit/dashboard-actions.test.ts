import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({ db: { insert: vi.fn(), delete: vi.fn() } }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((u: string) => { throw new Error("REDIRECT:" + u); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { createResume } from "@/app/(app)/dashboard/actions";

describe("createResume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to login when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    await expect(createResume()).rejects.toThrow("REDIRECT:/login");
  });

  it("inserts a resume and redirects to edit", async () => {
    (auth as any).mockResolvedValue({ user: { id: "u1" } });
    const returning = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as any).mockReturnValue({ values });
    await expect(createResume()).rejects.toThrow("REDIRECT:/resume/r1/edit");
    expect(values).toHaveBeenCalled();
  });
});
