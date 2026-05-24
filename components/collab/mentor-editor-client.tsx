"use client";

/**
 * Mentor's collaborative editor — renders the same dual-panel layout as the
 * owner's EditorClient, but without autosave, share, export, template controls.
 * Form state is synced via Y.Map through PartyKit.
 */

import { useEffect, useState, useRef } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ResumeContent, DEFAULT_SECTION_ORDER, BUILTIN_SECTION_KEYS } from "@/lib/resume-schema";
import { LivePreview } from "@/components/preview/live-preview";
import { BasicsEditor } from "@/components/editor/basics-editor";
import { ExperienceEditor } from "@/components/editor/experience-editor";
import { EducationEditor } from "@/components/editor/education-editor";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { SkillsEditor } from "@/components/editor/skills-editor";
import { SectionWrapper } from "@/components/editor/section-wrapper";
import { CustomSectionEditor } from "@/components/editor/custom-section-editor";
import { PresenceBar } from "@/components/collab/presence-bar";
import { VoiceChatControls } from "@/components/collab/voice-chat-controls";
import { AnnotationPopover } from "@/components/collab/annotation-popover";
import { AnnotationList } from "@/components/collab/annotation-list";
import { AnnotationHighlights, flashAnnotation } from "@/components/collab/annotation-highlights";
import { useCollabProvider, type CollabConfig } from "@/hooks/use-collab-provider";
import { useCollabFormSync } from "@/hooks/use-collab-form-sync";
import { useAnnotations } from "@/hooks/use-annotations";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateId } from "@/lib/templates/registry";
import type { ResumeContent as ResumeContentType } from "@/lib/resume-schema";

type Props = {
  resumeTitle: string;
  initialContent: ResumeContentType;
  templateId: TemplateId;
  mode: "edit" | "comment";
};

export function MentorEditorClient({ resumeTitle, initialContent, templateId, mode }: Props) {
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

  if (!collabState?.isConnected) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在连接协作空间…</p>
      </div>
    );
  }

  return (
    <MentorEditorInner
      resumeTitle={resumeTitle}
      initialContent={initialContent}
      templateId={templateId}
      mode={mode}
      ydoc={collabState.ydoc}
      provider={collabState.provider}
      presenceUsers={collabState.presenceUsers}
      isConnected={collabState.isConnected}
      displayName={config.displayName}
    />
  );
}

function MentorEditorInner({
  resumeTitle,
  initialContent,
  templateId,
  mode,
  ydoc,
  provider,
  presenceUsers,
  isConnected,
  displayName,
}: {
  resumeTitle: string;
  initialContent: ResumeContentType;
  templateId: TemplateId;
  mode: "edit" | "comment";
  ydoc: import("yjs").Doc;
  provider: unknown;
  presenceUsers: { userId: string; displayName: string; role: "owner" | "mentor"; color: string }[];
  isConnected: boolean;
  displayName: string;
}) {
  const form = useForm({
    resolver: zodResolver(ResumeContent),
    defaultValues: initialContent,
    mode: "onChange",
  });

  // Bidirectional form sync via Y.Map
  // In edit mode: mentor can write. In comment mode: mentor only receives owner's edits.
  const collabSync = useCollabFormSync({
    ydoc,
    form,
    role: "mentor",
    enabled: isConnected,
  });

  // Annotations (for comment mode)
  const { annotations, addAnnotation, updateStatus } = useAnnotations({
    ydoc,
    enabled: isConnected && mode === "comment",
  });

  const previewRef = useRef<HTMLDivElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  const sectionOrder = form.watch("sectionOrder") ?? [...DEFAULT_SECTION_ORDER];

  function isCustomSection(key: string): boolean {
    return !BUILTIN_SECTION_KEYS.has(key);
  }

  return (
    <FormProvider {...form}>
      {/* Simplified toolbar for mentor */}
      <div className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <h1 className="text-base font-medium">{resumeTitle}</h1>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {mode === "edit" ? "帮改模式" : "批注模式"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <VoiceChatControls provider={provider} enabled={presenceUsers.length >= 2} />
            <PresenceBar users={presenceUsers} isConnected={isConnected} />
          </div>
        </div>
      </div>

      {/* Collab activity bar */}
      {collabSync.changeLog.length > 0 && (
        <div className="border-b border-blue-200 bg-blue-50/50 px-4 py-1.5 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-blue-700 dark:text-blue-300">协作动态</span>
            <span className="text-blue-500 dark:text-blue-400">
              {collabSync.changeLog.slice(-3).map((entry) => (
                <span key={entry.id} className="mr-3">
                  [{new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}]
                  {" "}{entry.author === "owner" ? "对方" : "你"}修改了「{entry.subfield}」
                </span>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* Dual-panel layout */}
      <div className="flex h-[calc(100vh-3rem)]">
        {mode === "edit" ? (
          <>
            {/* Left: form editors (帮改模式) */}
            <div className="thin-scrollbar w-1/2 space-y-6 overflow-y-auto border-r p-6">
              <div className={cn(
                "rounded-lg transition-all duration-500",
                collabSync.highlightedFields.has("basics") && "ring-2 ring-blue-400/60 bg-blue-50/30 dark:bg-blue-950/20"
              )}>
                <BasicsEditor />
              </div>
              {sectionOrder.filter((k: string) => k !== "basics").map((key: string) => (
                <div key={key} className={cn(
                  "rounded-lg transition-all duration-500",
                  collabSync.highlightedFields.has(key) && "ring-2 ring-blue-400/60 bg-blue-50/30 dark:bg-blue-950/20"
                )}>
                  <SectionWrapper id={key}>
                    {key === "experience" && <ExperienceEditor />}
                    {key === "education" && <EducationEditor />}
                    {key === "projects" && <ProjectsEditor />}
                    {key === "skills" && <SkillsEditor />}
                    {isCustomSection(key) && <CustomSectionEditor sectionId={key} />}
                  </SectionWrapper>
                </div>
              ))}
            </div>
            {/* Right: live preview (帮改模式) */}
            <div className="thin-scrollbar w-1/2 overflow-y-auto bg-muted p-6">
              <LivePreview templateId={templateId} />
            </div>
          </>
        ) : (
          <>
            {/* Left: annotation list (批注模式) */}
            <div className="thin-scrollbar w-[360px] shrink-0 overflow-y-auto border-r p-4">
              <AnnotationList
                annotations={annotations}
                canManage={false}
                onClickAnnotation={(ann) => flashAnnotation(ann.id)}
              />
            </div>
            {/* Right: preview with annotation popover (批注模式) */}
            <div ref={previewRef} className="thin-scrollbar relative flex-1 overflow-y-auto bg-muted p-6">
              <LivePreview ref={previewContentRef} templateId={templateId} />
              <AnnotationHighlights previewRef={previewContentRef} annotations={annotations} />
              <AnnotationPopover
                previewRef={previewRef}
                onSubmit={(data) => addAnnotation({ ...data, authorName: displayNameRef.current })}
                enabled
              />
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <p className="border-t py-2 text-center text-xs text-muted-foreground">
        你的修改将实时同步给对方 · 协同会话 24 小时内有效
      </p>
    </FormProvider>
  );
}
