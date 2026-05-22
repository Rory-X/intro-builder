"use server";
import { signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const EmailSchema = z.object({ email: z.string().email() });

export async function sendLoginLink(formData: FormData): Promise<void> {
  const parsed = EmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/login?error=invalid-email");
  }
  await signIn("resend", { email: parsed.data.email, redirectTo: "/dashboard" });
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
