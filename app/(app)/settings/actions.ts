"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { sendVerificationCode, verifyCode } from "@/lib/email-code";
import { withDbRetry } from "@/lib/db-retry";

/** Send verification code to the authenticated user's email */
export async function sendCode(): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { success: false, error: "未登录" };

  try {
    await sendVerificationCode(session.user.email);
    return { success: true };
  } catch (e) {
    console.error("[sendCode]", e);
    return { success: false, error: "发送失败，请稍后重试" };
  }
}

const SetPasswordSchema = z.object({
  code: z.string().length(6),
  password: z.string().min(6, "密码至少 6 位"),
});

/** Verify code and set/update password */
export async function setPassword(
  input: { code: string; password: string },
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email || !session?.user?.id) {
    return { success: false, error: "未登录" };
  }

  const parsed = SetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "输入无效" };
  }

  const { code, password } = parsed.data;
  const email = session.user.email;
  const userId = session.user.id;

  // Verify the code
  const valid = await verifyCode(email, code);
  if (!valid) {
    return { success: false, error: "验证码无效或已过期" };
  }

  // Hash and save password
  const passwordHash = await bcrypt.hash(password, 12);
  await withDbRetry("setPassword", () =>
    db.update(users).set({ passwordHash }).where(eq(users.id, userId)),
  );

  return { success: true };
}

/** Check if current user has a password set */
export async function hasPassword(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;
  const userId = session.user.id;

  const user = await withDbRetry("hasPassword", () =>
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { passwordHash: true },
    }),
  );

  return !!user?.passwordHash;
}
