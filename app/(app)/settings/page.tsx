import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasPassword } from "./actions";
import { PasswordSettings } from "./password-settings";
import { Mail, KeyRound, Shield } from "lucide-react";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "账户设置" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const passwordSet = await hasPassword();

  return (
    <main className="mx-auto max-w-xl px-4 py-12 md:py-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">账户设置</h1>
          <p className="text-sm text-muted-foreground">管理你的登录方式与账户安全</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Email card */}
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">登录邮箱</div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">
                {session.user.email}
              </div>
            </div>
          </div>
        </div>

        {/* Password card */}
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
              <KeyRound className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">登录密码</span>
                {passwordSet ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    已设置
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    未设置
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {passwordSet
                  ? "你可以使用邮箱 + 密码直接登录"
                  : "设置密码后可使用邮箱 + 密码登录，无需等待魔法链接"}
              </p>
              <div className="mt-4">
                <PasswordSettings hasExisting={passwordSet} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
