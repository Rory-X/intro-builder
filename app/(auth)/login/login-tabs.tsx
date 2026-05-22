"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  sendLoginLink: (formData: FormData) => Promise<void>;
  loginWithPassword: (formData: FormData) => Promise<void>;
};

export function LoginTabs({ sendLoginLink, loginWithPassword }: Props) {
  const [tab, setTab] = useState<"magic" | "password">("magic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handlePasswordSubmit(formData: FormData) {
    setLoading(true);
    setError("");
    try {
      await loginWithPassword(formData);
    } catch {
      setError("邮箱或密码错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Tab switcher */}
      <div className="mb-4 flex rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => { setTab("magic"); setError(""); }}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "magic" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          魔法链接
        </button>
        <button
          type="button"
          onClick={() => { setTab("password"); setError(""); }}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "password" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          密码登录
        </button>
      </div>

      {/* Magic link form */}
      {tab === "magic" && (
        <form action={sendLoginLink} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-magic">邮箱</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="email-magic" name="email" type="email" required placeholder="you@example.com" className="pl-9" />
            </div>
          </div>
          <Button type="submit" className="w-full shadow-sm shadow-primary/20">发送登录链接</Button>
        </form>
      )}

      {/* Password form */}
      {tab === "password" && (
        <form action={handlePasswordSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-pwd">邮箱</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="email-pwd" name="email" type="email" required placeholder="you@example.com" className="pl-9" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">密码</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="password" name="password" type="password" required placeholder="输入密码" className="pl-9" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full shadow-sm shadow-primary/20">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            登录
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            还没设置密码？使用魔法链接登录后可在设置中设置密码。
          </p>
        </form>
      )}
    </div>
  );
}
