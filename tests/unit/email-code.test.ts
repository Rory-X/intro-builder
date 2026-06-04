import { describe, expect, it, vi } from "vitest";

describe("email-code", () => {
  it("does not require a Resend API key during module import", async () => {
    const originalKey = process.env.AUTH_RESEND_KEY;
    delete process.env.AUTH_RESEND_KEY;
    vi.resetModules();

    try {
      await expect(import("@/lib/email-code")).resolves.toHaveProperty("generateCode");
    } finally {
      if (originalKey === undefined) {
        delete process.env.AUTH_RESEND_KEY;
      } else {
        process.env.AUTH_RESEND_KEY = originalKey;
      }
      vi.resetModules();
    }
  });
});
