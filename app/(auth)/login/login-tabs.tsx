"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Lock, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoginActionResult } from "./actions";

type Props = {
  sendLoginCode: (formData: FormData) => Promise<LoginActionResult>;
  loginWithEmailCode: (formData: FormData) => Promise<void>;
  sendLoginLink: (formData: FormData) => Promise<void>;
  loginWithPassword: (formData: FormData) => Promise<void>;
};

type LoginTab = "code" | "magic" | "password";

const TABS: Array<{ id: LoginTab; label: string }> = [
  { id: "code", label: "邮箱验证码" },
  { id: "magic", label: "魔法链接" },
  { id: "password", label: "密码登录" },
];

export function LoginTabs({
  sendLoginCode,
  loginWithEmailCode,
  sendLoginLink,
  loginWithPassword,
}: Props) {
  const [tab, setTab] = useState<LoginTab>("code");
  const [error, setError] = useState("");
  const [sentCodeEmail, setSentCodeEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeSendPending, startCodeSendTransition] = useTransition();
  const [codeLoginPending, startCodeLoginTransition] = useTransition();
  const [magicPending, startMagicTransition] = useTransition();
  const [pwdPending, startPwdTransition] = useTransition();

  function selectTab(nextTab: LoginTab) {
    setTab(nextTab);
    setError("");
  }

  function handleCodeSend(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    setError("");
    startCodeSendTransition(async () => {
      const result = await sendLoginCode(formData);
      if (!result.success) {
        setError(result.error ?? "验证码发送失败，请稍后重试");
        return;
      }
      setSentCodeEmail(email);
      setCodeSent(true);
    });
  }

  function handleCodeLogin(formData: FormData) {
    setError("");
    startCodeLoginTransition(async () => {
      try {
        await loginWithEmailCode(formData);
      } catch {
        setError("验证码无效或已过期");
      }
    });
  }

  function handleMagicSubmit(formData: FormData) {
    startMagicTransition(async () => {
      await sendLoginLink(formData);
    });
  }

  function handlePasswordSubmit(formData: FormData) {
    setError("");
    startPwdTransition(async () => {
      try {
        await loginWithPassword(formData);
      } catch {
        setError("邮箱或密码错误");
      }
    });
  }

  return (
    <div>
      {/* Tab switcher */}
      <div className="mb-4 flex rounded-lg bg-muted p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:text-sm",
              tab === item.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Email code form */}
      {tab === "code" && (
        codeSent ? (
          <form action={handleCodeLogin} className="flex flex-col gap-4">
            <fieldset disabled={codeLoginPending} className="flex flex-col gap-4">
              <input type="hidden" name="email" value={sentCodeEmail} />
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">验证码已发送</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">{sentCodeEmail}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-code">验证码</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    placeholder="6 位数字验证码"
                    className="pl-9"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={codeLoginPending} className="w-full shadow-sm shadow-primary/20">
                {codeLoginPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {codeLoginPending ? "登录中…" : "登录 / 注册"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={codeLoginPending}
                onClick={() => { setCodeSent(false); setError(""); }}
                className="w-full"
              >
                修改邮箱
              </Button>
            </fieldset>
          </form>
        ) : (
          <form action={handleCodeSend} className="flex flex-col gap-4">
            <fieldset disabled={codeSendPending} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-code-login">邮箱</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email-code-login"
                    name="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    className="pl-9"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={codeSendPending} className="w-full shadow-sm shadow-primary/20">
                {codeSendPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {codeSendPending ? "发送中…" : "发送验证码"}
              </Button>
            </fieldset>
          </form>
        )
      )}

      {/* Magic link form */}
      {tab === "magic" && (
        <form action={handleMagicSubmit} className="flex flex-col gap-4">
          <fieldset disabled={magicPending} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-magic">邮箱</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email-magic" name="email" type="email" required placeholder="you@example.com" className="pl-9" />
              </div>
            </div>
            <Button type="submit" disabled={magicPending} className="w-full shadow-sm shadow-primary/20">
              {magicPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {magicPending ? "发送中…" : "发送登录链接"}
            </Button>
          </fieldset>
        </form>
      )}

      {/* Password form */}
      {tab === "password" && (
        <form action={handlePasswordSubmit} className="flex flex-col gap-4">
          <fieldset disabled={pwdPending} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={pwdPending} className="w-full shadow-sm shadow-primary/20">
              {pwdPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pwdPending ? "登录中…" : "登录"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              还没设置密码？使用魔法链接登录后可在设置中设置密码。
            </p>
          </fieldset>
        </form>
      )}
    </div>
  );
}
