import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  signIn: vi.fn(),
}));

vi.mock("@/lib/email-code", () => ({
  sendVerificationCode: vi.fn(),
}));

import { signIn } from "@/lib/auth";
import { sendVerificationCode } from "@/lib/email-code";
import { loginWithEmailCode, sendLoginCode } from "@/app/(auth)/login/actions";

function formDataWith(...entries: string[]) {
  const formData = new FormData();
  for (let index = 0; index < entries.length; index += 2) {
    formData.set(entries[index]!, entries[index + 1]!);
  }
  return formData;
}

describe("login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a login verification code", async () => {
    (sendVerificationCode as unknown as Mock).mockResolvedValue(undefined);

    await expect(sendLoginCode(formDataWith(
      "email",
      " Me@Example.com ",
    ))).resolves.toEqual({ success: true });

    expect(sendVerificationCode).toHaveBeenCalledWith("me@example.com", "login");
  });

  it("returns a validation error for an invalid login-code email", async () => {
    await expect(sendLoginCode(formDataWith(
      "email",
      "not-email",
    ))).resolves.toEqual({
      success: false,
      error: "请输入有效邮箱",
    });

    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("signs in with the email-code provider", async () => {
    await loginWithEmailCode(formDataWith(
      "email",
      " Me@Example.com ",
      "code",
      "123456",
    ));

    expect(signIn).toHaveBeenCalledWith("email-code", {
      email: "me@example.com",
      code: "123456",
      redirectTo: "/dashboard",
    });
  });

  it("rejects invalid login-code input", async () => {
    await expect(loginWithEmailCode(formDataWith(
      "email",
      "me@example.com",
      "code",
      "12",
    ))).rejects.toThrow("invalid-input");

    expect(signIn).not.toHaveBeenCalled();
  });
});
