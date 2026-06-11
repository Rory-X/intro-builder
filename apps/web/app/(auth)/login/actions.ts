"use server";
import { signIn } from "@/lib/auth";
import { sendVerificationCode } from "@/lib/email-code";
import { redirect } from "next/navigation";
import { z } from "zod";

const EmailSchema = z.object({ email: z.string().trim().email() });
const LoginCodeSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().regex(/^\d{6}$/),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type LoginActionResult = {
  success: boolean;
  error?: string;
};

export async function sendLoginLink(formData: FormData): Promise<void> {
  const parsed = EmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/login?error=invalid-email");
  }
  await signIn("resend", { email: parsed.data.email, redirectTo: "/dashboard" });
}

export async function sendLoginCode(formData: FormData): Promise<LoginActionResult> {
  const parsed = EmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { success: false, error: "请输入有效邮箱" };
  }

  try {
    await sendVerificationCode(normalizeEmail(parsed.data.email), "login");
    return { success: true };
  } catch (error) {
    console.error("[sendLoginCode]", error);
    return { success: false, error: "验证码发送失败，请稍后重试" };
  }
}

const PasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginWithPassword(formData: FormData): Promise<void> {
  const parsed = PasswordSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    throw new Error("invalid-input");
  }
  await signIn("credentials", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirectTo: "/dashboard",
  });
}

export async function loginWithEmailCode(formData: FormData): Promise<void> {
  const parsed = LoginCodeSchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    throw new Error("invalid-input");
  }

  await signIn("email-code", {
    email: normalizeEmail(parsed.data.email),
    code: parsed.data.code,
    redirectTo: "/dashboard",
  });
}
