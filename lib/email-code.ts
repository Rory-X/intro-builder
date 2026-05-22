import { db } from "@/db";
import { verificationTokens } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { Resend } from "resend";

const resend = new Resend(process.env.AUTH_RESEND_KEY);
const EMAIL_FROM = process.env.AUTH_EMAIL_FROM ?? "noreply@example.com";

/** Generate a 6-digit numeric verification code */
export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Store a verification code in the database (5 min expiry) */
export async function saveVerificationCode(email: string, code: string): Promise<void> {
  const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Delete any existing codes for this email first
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, email));

  // Insert new code
  await db.insert(verificationTokens).values({
    identifier: email,
    token: code,
    expires,
  });
}

/** Verify and consume a code (one-time use). Returns true if valid. */
export async function verifyCode(email: string, code: string): Promise<boolean> {
  const record = await db.query.verificationTokens.findFirst({
    where: and(
      eq(verificationTokens.identifier, email),
      eq(verificationTokens.token, code),
    ),
  });

  if (!record) return false;
  if (record.expires < new Date()) {
    // Expired — clean up
    await db.delete(verificationTokens).where(
      and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, code)),
    );
    return false;
  }

  // Valid — consume (delete)
  await db.delete(verificationTokens).where(
    and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, code)),
  );
  return true;
}

/** Send a verification code email via Resend */
export async function sendVerificationCode(email: string): Promise<void> {
  const code = generateCode();
  await saveVerificationCode(email, code);

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: "intro-builder 验证码",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #111; margin-bottom: 16px;">验证码</h2>
        <p style="color: #555; font-size: 14px; margin-bottom: 20px;">
          你正在设置或修改密码，请使用以下验证码完成验证：
        </p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 20px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111;">${code}</span>
        </div>
        <p style="color: #888; font-size: 12px;">验证码 5 分钟内有效，请勿分享给他人。</p>
      </div>
    `,
  });
}
