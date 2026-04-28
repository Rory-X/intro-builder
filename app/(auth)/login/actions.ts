"use server";
import { signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const Schema = z.object({ email: z.string().email() });

export async function sendLoginLink(formData: FormData): Promise<void> {
  const parsed = Schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/login?error=invalid-email");
  }
  await signIn("resend", { email: parsed.data.email, redirectTo: "/dashboard" });
}
