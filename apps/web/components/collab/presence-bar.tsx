"use client";

import { cn } from "@/lib/utils";
import type { PresenceUser } from "@/hooks/use-collab-provider";

type Props = {
  users: PresenceUser[];
  isConnected: boolean;
};

export function PresenceBar({ users, isConnected }: Props) {
  if (users.length === 0 && isConnected) return null;

  return (
    <div className="flex items-center gap-2">
      {/* Connection status dot */}
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          isConnected ? "bg-emerald-500" : "bg-red-500 animate-pulse",
        )}
        title={isConnected ? "已连接" : "连接中…"}
      />

      {/* User avatars */}
      <div className="flex -space-x-1.5">
        {users.map((u) => (
          <div
            key={u.userId}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-medium text-white"
            style={{ backgroundColor: u.color }}
            title={`${u.displayName}${u.role === "mentor" ? "（导师）" : "（作者）"}`}
          >
            {u.displayName[0]}
          </div>
        ))}
      </div>

      {users.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {users.length}人在线
        </span>
      )}
    </div>
  );
}
