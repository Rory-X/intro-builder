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

  async function handleCreate() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/collab/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId, mode: "edit" }),
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
    if (!inviteUrl) {
      void handleCreate();
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={handleOpen}>
        <Users className="h-4 w-4" />
        邀请协作
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀请导师协作</DialogTitle>
            <DialogDescription>
              生成邀请链接发送给导师，对方无需注册即可进入帮改
            </DialogDescription>
          </DialogHeader>

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
