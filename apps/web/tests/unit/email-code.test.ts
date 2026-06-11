import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbDeleteWhere: vi.fn(),
  dbInsertValues: vi.fn(),
  resendSend: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    delete: vi.fn(() => ({ where: mocks.dbDeleteWhere })),
    insert: vi.fn(() => ({ values: mocks.dbInsertValues })),
  },
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function MockResend(this: { emails: { send: typeof mocks.resendSend } }) {
    this.emails = {
      send: mocks.resendSend,
    };
  }),
}));

describe("email-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_RESEND_KEY = "test-key";
    process.env.AUTH_EMAIL_FROM = "Intro <noreply@example.com>";
  });

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

  it("sends login-specific verification code copy", async () => {
    vi.resetModules();
    const { sendVerificationCode } = await import("@/lib/email-code");

    await sendVerificationCode("me@example.com", "login");

    expect(mocks.resendSend).toHaveBeenCalledWith(expect.objectContaining({
      to: "me@example.com",
      subject: "intro-builder 登录验证码",
      html: expect.stringContaining("登录 intro-builder"),
    }));
  });

  it("keeps password-specific verification code copy", async () => {
    vi.resetModules();
    const { sendVerificationCode } = await import("@/lib/email-code");

    await sendVerificationCode("me@example.com", "password");

    expect(mocks.resendSend).toHaveBeenCalledWith(expect.objectContaining({
      subject: "intro-builder 验证码",
      html: expect.stringContaining("设置或修改密码"),
    }));
  });
});
