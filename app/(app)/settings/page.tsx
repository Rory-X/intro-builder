import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasPassword } from "./actions";
import { PasswordSettings } from "./password-settings";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "账户设置" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const passwordSet = await hasPassword();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">账户设置</h1>
      <p className="mt-1 text-sm text-muted-foreground">管理你的账户安全</p>

      <div className="mt-8 space-y-6">
        {/* Email display */}
        <div className="rounded-lg border p-4">
          <div className="text-sm font-medium text-muted-foreground">邮箱</div>
          <div className="mt-1 text-sm">{session.user.email}</div>
        </div>

        {/* Password section */}
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">密码</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {passwordSet ? "已设置" : "未设置 — 设置后可使用邮箱+密码登录"}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <PasswordSettings hasExisting={passwordSet} />
          </div>
        </div>
      </div>
    </main>
  );
}
