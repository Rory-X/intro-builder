"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Copy, Check, Users, Loader2 } from "lucide-react";

type Props = {
  resumeId: string;
  onSessionCreated: (sessionId: string) => void;
};

export function InviteCollabDialog({ resumeId, onSessionCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"edit" | "comment">("edit");

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

  function handleOpen() {
    setOpen(true);
    // Don't auto-create — let user pick mode first
  }

  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleOpen} title="邀请协作" aria-label="邀请协作">
        <Users className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀请导师协作</DialogTitle>
            <DialogDescription>
              选择协作模式，生成邀请链接发送给导师
            </DialogDescription>
          </DialogHeader>

          {/* Mode selector */}
          {!inviteUrl && !loading && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${mode === "edit" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                >
                  <p className="text-sm font-medium">帮改模式</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">导师可直接编辑简历内容</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("comment")}
                  className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${mode === "comment" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                >
                  <p className="text-sm font-medium">批注模式</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">导师选中文字添加评论建议</p>
                </button>
              </div>
              <Button onClick={handleCreate} className="w-full">
                生成邀请链接
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          {inviteUrl && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input value={inviteUrl} readOnly className="text-xs" />
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                链接有效期 24 小时，导师打开后输入昵称即可进入
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
