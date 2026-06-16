"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare, Plus, Trash2 } from "lucide-react";
import type { AgentSessionListItem } from "@/lib/agent/session-store";

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString("zh-CN");
}

type AgentSessionSelectorProps = {
  sessions: AgentSessionListItem[];
  activeSessionId: string;
  isLoading?: boolean;
  onOpen?: () => void;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void | Promise<void>;
};

export function AgentSessionSelector({
  sessions,
  activeSessionId,
  isLoading = false,
  onOpen,
  onSelect,
  onCreate,
  onDelete,
}: AgentSessionSelectorProps) {
  const [open, setOpen] = useState(false);
  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) onOpen?.();
            return next;
          });
        }}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted"
      >
        <MessageSquare className="h-3 w-3 shrink-0" />
        <span className="max-w-[100px] truncate">
          {activeSession?.title ?? "选择对话"}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover shadow-md">
            <button
              type="button"
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted border-b"
            >
              <Plus className="h-3 w-3" />
              新建对话
            </button>
            <div className="max-h-48 overflow-y-auto">
              {isLoading ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  正在加载
                </div>
              ) : sessions.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  暂无历史对话
                </div>
              ) : (
                sessions.map((session) => {
                  const isActive = session.sessionId === activeSessionId;
                  return (
                    <div
                      key={session.sessionId}
                      className={`flex items-center justify-between px-3 py-2 hover:bg-muted group ${
                        isActive ? "bg-muted/50" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(session.sessionId);
                          setOpen(false);
                        }}
                        className="flex-1 min-w-0 text-left text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{session.title}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatRelativeTime(session.updatedAt)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(session.sessionId);
                        }}
                        className="shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="删除对话"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
