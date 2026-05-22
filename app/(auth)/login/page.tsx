import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sendLoginLink, loginWithPassword } from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import { LoginTabs } from "./login-tabs";
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
          <p className="mt-2 text-sm text-muted-foreground">选择一种方式登录你的账户</p>
        </div>

        <Card className="shadow-lg shadow-black/5">
          <CardContent className="pt-6">
            <LoginTabs
              sendLoginLink={sendLoginLink}
              loginWithPassword={loginWithPassword}
            />
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          登录即表示同意 <a href="/terms" className="underline underline-offset-2 transition-colors hover:text-foreground">用户协议</a>
        </p>
      </div>
    </main>
  );
}
