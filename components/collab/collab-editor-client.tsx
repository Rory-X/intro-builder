"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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

export function CollabEditorClient({ resumeTitle, resumeContent, mode }: Props) {
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

  if (!collabState?.isConnected || !collabState?.ydoc || !collabState?.provider) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在连接协作空间…</p>
      </div>
    );
  }

  // Only render editor once Y.js is synced
  return (
    <CollabEditorInner
      resumeTitle={resumeTitle}
      resumeContent={resumeContent}
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
  resumeContent,
  mode,
  ydoc,
  provider,
  displayName,
  presenceUsers,
  isConnected,
}: {
  resumeTitle: string;
  resumeContent: ResumeContent;
  mode: "edit" | "comment";
  ydoc: Doc;
  provider: unknown;
  displayName: string;
  presenceUsers: { userId: string; displayName: string; role: "owner" | "mentor"; color: string }[];
  isConnected: boolean;
}) {
  const seededRef = useRef(false);

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

  // Seed Y.js document with resume content when it's empty
  useEffect(() => {
    if (!editor || seededRef.current) return;

    // Wait a tick for Y.js sync to complete
    const timer = setTimeout(() => {
      if (seededRef.current) return;

      // Check if Y.js fragment is empty
      const fragment = ydoc.getXmlFragment("default");
      if (fragment.length === 0) {
        // Build a flat TipTap document from resume content
        const doc = resumeContentToCollabDoc(resumeContent, resumeTitle);
        editor.commands.setContent(doc);
        seededRef.current = true;
      } else {
        // Already has content from another peer or persisted state
        seededRef.current = true;
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [editor, ydoc, resumeContent, resumeTitle]);

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

/**
 * Convert structured ResumeContent into a flat TipTap document for collaborative editing.
 * Creates a readable document with section headings and content.
 */
function resumeContentToCollabDoc(content: ResumeContent, title: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = [];

  // Helper to create a heading node
  const heading = (text: string, level: number = 2) => ({
    type: "heading",
    attrs: { level },
    content: text ? [{ type: "text", text }] : [],
  });

  // Helper to create a paragraph
  const para = (text: string) => ({
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  });

  // Helper to extract text content from TipTap JSON
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractNodes = (doc: any) => {
    if (!doc || !doc.content || !Array.isArray(doc.content)) return [];
    return doc.content;
  };

  // Title
  nodes.push(heading(title, 1));

  // Basics
  const { basics } = content;
  if (basics.name) nodes.push(para(`姓名：${basics.name}`));
  if (basics.title) nodes.push(para(`目标岗位：${basics.title}`));
  if (basics.email) nodes.push(para(`邮箱：${basics.email}`));
  if (basics.phone) nodes.push(para(`电话：${basics.phone}`));
  if (basics.location) nodes.push(para(`所在地：${basics.location}`));
  if (basics.summary) {
    nodes.push({ type: "paragraph" });
    nodes.push(heading("个人总结"));
    nodes.push(para(basics.summary));
  }

  // Experience
  if (content.experience.length > 0) {
    nodes.push({ type: "paragraph" });
    nodes.push(heading("工作经历"));
    for (const exp of content.experience) {
      const titleLine = [exp.company, exp.title].filter(Boolean).join(" · ");
      const dateLine = [exp.start, exp.end].filter(Boolean).join(" - ");
      if (titleLine) nodes.push(para(`【${titleLine}】${dateLine ? `  ${dateLine}` : ""}`));
      if (exp.content) nodes.push(...extractNodes(exp.content));
    }
  }

  // Education
  if (content.education.length > 0) {
    nodes.push({ type: "paragraph" });
    nodes.push(heading("教育经历"));
    for (const edu of content.education) {
      const titleLine = [edu.school, edu.degree, edu.major].filter(Boolean).join(" · ");
      const dateLine = [edu.start, edu.end].filter(Boolean).join(" - ");
      if (titleLine) nodes.push(para(`【${titleLine}】${dateLine ? `  ${dateLine}` : ""}`));
      if (edu.highlights) nodes.push(...extractNodes(edu.highlights));
    }
  }

  // Projects
  if (content.projects.length > 0) {
    nodes.push({ type: "paragraph" });
    nodes.push(heading("项目经历"));
    for (const proj of content.projects) {
      const titleLine = [proj.name, proj.role].filter(Boolean).join(" · ");
      const dateLine = [proj.start, proj.end].filter(Boolean).join(" - ");
      if (titleLine) nodes.push(para(`【${titleLine}】${dateLine ? `  ${dateLine}` : ""}`));
      if (proj.content) nodes.push(...extractNodes(proj.content));
    }
  }

  // Skills
  if (content.skills.length > 0) {
    nodes.push({ type: "paragraph" });
    nodes.push(heading("技能"));
    for (const group of content.skills) {
      const items = group.items?.join("、") || "";
      if (group.category || items) {
        nodes.push(para(`${group.category ? group.category + "：" : ""}${items}`));
      }
    }
  }

  // Ensure at least one node
  if (nodes.length === 0) {
    nodes.push(para("在此开始编辑简历内容…"));
  }

  return { type: "doc", content: nodes };
}
