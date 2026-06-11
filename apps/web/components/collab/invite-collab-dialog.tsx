"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Copy, Check, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  resumeId: string;
  onSessionCreated: (sessionId: string) => void;
  isActive?: boolean;
};

export function InviteCollabDialog({ resumeId, onSessionCreated, isActive = false }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"edit" | "comment">("edit");

  function handleReset() {
    setInviteUrl("");
    setError("");
    setCopied(false);
  }

  async function handleCreate() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/collab/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId, mode }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }

      const { sessionId, inviteUrl: url } = await res.json();
      setInviteUrl(url);
      onSessionCreated(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className={cn("h-8 w-8", isActive && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")} title="邀请协作" aria-label="邀请协作" />}
      >
        <Users className="h-4 w-4" />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">邀请导师协作</p>
            <p className="mt-0.5 text-xs text-muted-foreground">选择协作模式，生成邀请链接</p>
          </div>

          {!inviteUrl && !loading && (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  className={`flex-1 rounded-lg border-2 p-2.5 text-left transition-colors ${mode === "edit" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                >
                  <p className="text-xs font-medium">帮改模式</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">导师可直接编辑</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("comment")}
                  className={`flex-1 rounded-lg border-2 p-2.5 text-left transition-colors ${mode === "comment" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                >
                  <p className="text-xs font-medium">批注模式</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">导师添加评论</p>
                </button>
              </div>
              <Button onClick={handleCreate} size="sm" className="w-full">
                生成邀请链接
              </Button>
            </>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-center text-xs text-destructive">{error}</p>
          )}

          {inviteUrl && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input value={inviteUrl} readOnly className="text-xs" />
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                链接有效期 24 小时，导师打开后输入昵称即可进入
              </p>
              <Button onClick={handleReset} size="sm" variant="outline" className="w-full text-xs text-destructive hover:text-destructive">
                取消协作
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
