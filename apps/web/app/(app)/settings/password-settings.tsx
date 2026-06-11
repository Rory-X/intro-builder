"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2 } from "lucide-react";
import { sendCode, setPassword } from "./actions";

type Step = "idle" | "sending" | "code" | "password" | "success";

export function PasswordSettings({ hasExisting }: { hasExisting: boolean }) {
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [password, setPasswordVal] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    setLoading(true);
    setError("");
    const result = await sendCode();
    setLoading(false);
    if (result.success) {
      setStep("code");
    } else {
      setError(result.error ?? "发送失败");
    }
  }

  async function handleSetPassword() {
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次密码不一致");
      return;
    }
    setLoading(true);
    setError("");
    const result = await setPassword({ code, password });
    setLoading(false);
    if (result.success) {
      setStep("success");
    } else {
      setError(result.error ?? "设置失败");
    }
  }

  if (step === "success") {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600">
        <CheckCircle2 className="h-4 w-4" />
        密码{hasExisting ? "修改" : "设置"}成功
      </div>
    );
  }

  if (step === "idle" || step === "sending") {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleSendCode}
        disabled={loading}
      >
        {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {hasExisting ? "修改密码" : "设置密码"}
      </Button>
    );
  }

  if (step === "code") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">验证码已发送至你的邮箱，5 分钟内有效。</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">验证码</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6 位数字验证码"
            maxLength={6}
            className="max-w-[200px]"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setError(""); setStep("password"); }} disabled={code.length !== 6}>
            下一步
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSendCode} disabled={loading}>
            重新发送
          </Button>
        </div>
      </div>
    );
  }

  // step === "password"
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">新密码</Label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPasswordVal(e.target.value)}
          placeholder="至少 6 位"
          className="max-w-[280px]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">确认密码</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="再次输入密码"
          className="max-w-[280px]"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSetPassword} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          确认{hasExisting ? "修改" : "设置"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setStep("idle"); setError(""); }}>
          取消
        </Button>
      </div>
    </div>
  );
}
