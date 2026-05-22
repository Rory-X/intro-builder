"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Users } from "lucide-react";

type Props = {
  inviteToken: string;
  mode: string;
};

export function MentorJoinForm({ inviteToken, mode }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/collab/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken, mentorName: name.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "加入失败，请重试");
        return;
      }

      const { partyToken, roomId } = await res.json();

      // Store collab info in sessionStorage (ephemeral, mentor has no account)
      sessionStorage.setItem("collab:token", partyToken);
      sessionStorage.setItem("collab:roomId", roomId);
      sessionStorage.setItem("collab:role", "mentor");
      sessionStorage.setItem("collab:displayName", name.trim());

      // Redirect to the collaborative editor
      router.push(`/collab/${inviteToken}/edit`);
    } catch {
      setError("网络错误，请检查连接后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleJoin} className="space-y-4">
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>模式：{mode === "edit" ? "帮改（可直接编辑）" : "批注（只读+评论）"}</span>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">你的昵称</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入昵称，对方将看到此名称"
          maxLength={20}
          autoFocus
        />
      </div>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
        {loading ? (
          <>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            加入中…
          </>
        ) : (
          "进入协作"
        )}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        无需注册账号，输入昵称即可开始协作
      </p>
    </form>
  );
}
