"use client";

import { useEffect, useState, useMemo } from "react";
import { useCollabProvider, type CollabConfig } from "@/hooks/use-collab-provider";
import { PresenceBar } from "@/components/collab/presence-bar";
import { TemplateRenderer } from "@/components/preview/template-renderer";
import type { ResumeContent } from "@/lib/resume-schema";
import { Loader2 } from "lucide-react";

type Props = {
  resumeTitle: string;
  resumeContent: ResumeContent;
  templateId: string;
  mode: "edit" | "comment";
  role: "mentor";
};

export function CollabEditorClient({ resumeTitle, resumeContent, templateId, mode }: Props) {
  const [config, setConfig] = useState<CollabConfig | null>(null);
  const [ready, setReady] = useState(false);

  // Load collab config from sessionStorage on mount
  useEffect(() => {
    const token = sessionStorage.getItem("collab:token");
    const roomId = sessionStorage.getItem("collab:roomId");
    const displayName = sessionStorage.getItem("collab:displayName");

    if (token && roomId && displayName) {
      // Schedule state update to avoid sync setState in effect
      queueMicrotask(() => setConfig({ roomId, partyToken: token, displayName, role: "mentor" }));
    }
  }, []);

  const collabState = useCollabProvider(config);

  // Mark ready once synced
  useEffect(() => {
    if (collabState?.isSynced) {
      queueMicrotask(() => setReady(true));
    }
  }, [collabState?.isSynced]);

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">协作信息丢失，请重新通过邀请链接进入</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在连接协作空间…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium">{resumeTitle}</h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {mode === "edit" ? "帮改模式" : "批注模式"}
          </span>
        </div>
        <PresenceBar
          users={collabState?.presenceUsers || []}
          isConnected={collabState?.isConnected || false}
        />
      </header>

      {/* Editor area (simplified for MVP — shows preview for now) */}
      <main className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-[820px]">
          <div className="rounded-lg border bg-white p-4 text-center text-sm text-muted-foreground">
            <p>协同编辑器已连接</p>
            <p className="mt-1 text-xs">
              完整的 TipTap 协同编辑器将在 Phase E 完善后启用。
              当前版本验证 WebSocket 连接和在线状态同步。
            </p>
          </div>
          {/* Preview of current content */}
          <div className="mt-6 rounded-xl border shadow-sm" style={{ backgroundColor: "#ffffff" }}>
            <TemplateRenderer
              templateId={templateId}
              content={resumeContent}
              sectionOrder={resumeContent.sectionOrder}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
