import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyCode } from "@/lib/email-code";

export type EmailCodeLoginInput = {
  email: string;
  code: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function authorizeEmailCodeLogin(input: EmailCodeLoginInput) {
  const email = normalizeEmail(input.email);
  const valid = await verifyCode(email, input.code);
  if (!valid) return null;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
    };
  }

  const [created] = await db.insert(users).values({
    email,
    emailVerified: new Date(),
  }).returning({
    id: users.id,
    email: users.email,
    name: users.name,
  });

  if (!created) return null;

  return {
    id: created.id,
    email: created.email,
    name: created.name,
  };
}
