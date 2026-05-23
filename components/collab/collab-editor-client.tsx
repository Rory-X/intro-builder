"use client";

import { useEffect, useState, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useCollabProvider, type CollabConfig } from "@/hooks/use-collab-provider";
import { createCollabExtensions } from "@/lib/tiptap-extensions";
import { PresenceBar } from "@/components/collab/presence-bar";
import type { ResumeContent } from "@/lib/resume-schema";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RICH_TEXT_EDITOR_PROSE_CLASS } from "@/lib/rich-text-prose";
import type { Doc } from "yjs";

type Props = {
  resumeTitle: string;
  resumeContent: ResumeContent;
  templateId: string;
  mode: "edit" | "comment";
  role: "mentor";
};

export function CollabEditorClient({ resumeTitle, mode }: Props) {
  const [config, setConfig] = useState<CollabConfig | null>(null);

  // Load collab config from sessionStorage on mount
  useEffect(() => {
    const token = sessionStorage.getItem("collab:token");
    const roomId = sessionStorage.getItem("collab:roomId");
    const displayName = sessionStorage.getItem("collab:displayName");

    if (token && roomId && displayName) {
      queueMicrotask(() => setConfig({ roomId, partyToken: token, displayName, role: "mentor" }));
    }
  }, []);

  const collabState = useCollabProvider(config);

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">协作信息丢失，请重新通过邀请链接进入</p>
      </div>
    );
  }

  if (!collabState?.isSynced || !collabState?.ydoc || !collabState?.provider) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {collabState?.isConnected ? "正在同步文档…" : "正在连接协作空间…"}
        </p>
      </div>
    );
  }

  // Only render editor once Y.js is synced
  return (
    <CollabEditorInner
      resumeTitle={resumeTitle}
      mode={mode}
      ydoc={collabState.ydoc}
      provider={collabState.provider}
      displayName={config.displayName}
      presenceUsers={collabState.presenceUsers}
      isConnected={collabState.isConnected}
    />
  );
}

// Inner component — only mounted when Y.js is ready
function CollabEditorInner({
  resumeTitle,
  mode,
  ydoc,
  provider,
  displayName,
  presenceUsers,
  isConnected,
}: {
  resumeTitle: string;
  mode: "edit" | "comment";
  ydoc: Doc;
  provider: unknown;
  displayName: string;
  presenceUsers: { userId: string; displayName: string; role: "owner" | "mentor"; color: string }[];
  isConnected: boolean;
}) {
  const extensions = useMemo(
    () => createCollabExtensions(ydoc, provider, { name: displayName, color: "#8B5CF6" }),
    [ydoc, provider, displayName],
  );

  const editor = useEditor({
    extensions,
    editable: mode === "edit",
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[200px] bg-background px-4 py-3 text-sm focus:outline-none",
          RICH_TEXT_EDITOR_PROSE_CLASS,
        ),
      },
    },
    immediatelyRender: false,
  });

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium">{resumeTitle}</h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {mode === "edit" ? "帮改模式" : "批注模式"}
          </span>
        </div>
        <PresenceBar users={presenceUsers} isConnected={isConnected} />
      </header>

      {/* Editor */}
      <main className="flex-1 overflow-auto bg-muted/30 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border bg-background shadow-sm">
            {editor ? (
              <EditorContent editor={editor} />
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                编辑器加载中…
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            你的修改将实时同步给对方 · 协同会话 24 小时内有效
          </p>
        </div>
      </main>
    </div>
  );
}
