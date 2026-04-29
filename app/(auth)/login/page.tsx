import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sendLoginLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Mail } from "lucide-react";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-md shadow-primary/20">
            ib
          </div>
          <h1 className="text-2xl font-semibold">登录 intro-builder</h1>
          <p className="mt-2 text-sm text-muted-foreground">我们会给你的邮箱发送一个一次性登录链接。</p>
        </div>

        <Card className="shadow-lg shadow-black/5">
          <CardContent className="pt-6">
            <form action={sendLoginLink} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">邮箱</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="email" name="email" type="email" required placeholder="you@example.com" className="pl-9" />
                </div>
              </div>
              <Button type="submit" className="w-full shadow-sm shadow-primary/20">发送登录链接</Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          登录即表示同意 <a href="/terms" className="underline underline-offset-2 transition-colors hover:text-foreground">用户协议</a>
        </p>
      </div>
    </main>
  );
}
