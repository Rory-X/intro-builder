"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ResumeContent } from "@/lib/resume-schema";
import { saveResume, setTemplate, toggleShare } from "./actions";
import { useResumeAutosave } from "@/hooks/use-resume-autosave";
import { formatSaveError } from "@/lib/format-save-error";
import { LivePreview } from "@/components/preview/live-preview";
import { BasicsEditor } from "@/components/editor/basics-editor";
import { ExperienceEditor } from "@/components/editor/experience-editor";
import { EducationEditor } from "@/components/editor/education-editor";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { SkillsEditor } from "@/components/editor/skills-editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Share2 } from "lucide-react";
import { resolveTemplateId, type TemplateId } from "@/lib/templates/registry";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { SectionWrapper } from "@/components/editor/section-wrapper";
import { ModuleManager } from "@/components/editor/module-manager";
import { CustomSectionEditor } from "@/components/editor/custom-section-editor";
import { StyleEditor } from "@/components/editor/style-editor";
import { arrayMove } from "@/lib/array-move";
import { DEFAULT_SECTION_ORDER, BUILTIN_SECTION_KEYS } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { exportPreviewImage } from "@/lib/client/export-preview-image";
import { CompletenessScore } from "@/components/editor/completeness-score";
import { SmartLayoutButton } from "@/components/editor/smart-layout-button";
import { ExportButton } from "@/components/editor/export-button";
import { InviteCollabDialog } from "@/components/collab/invite-collab-dialog";
import { useCollabProvider } from "@/hooks/use-collab-provider";
import { useCollabFormSync } from "@/hooks/use-collab-form-sync";
import { PresenceBar } from "@/components/collab/presence-bar";

type Props = {
  id: string;
  initialTitle: string;
  initialTemplate: TemplateId;
  initialContent: ResumeContent;
  initialIsPublic: boolean;
  initialSlug: string | null;
  // Server passes an ISO string (NOT a Date instance) — Next 16's RSC
  // serializer has dropped Date through the SC → CC boundary in dev, which
  // would crash `lastSavedAt.getTime()` on first render. Strings are safe.
  initialUpdatedAtIso: string;
};

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToDesktopQuery(onStoreChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getDesktopSnapshot() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(DESKTOP_QUERY).matches
    : false;
}

function getServerDesktopSnapshot() {
  return false;
}

function formatRelativeSaveTime(savedAt: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - savedAt.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚保存";
  if (minutes < 60) return `${minutes}分钟前保存`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前保存`;
  const days = Math.floor(hours / 24);
  return `${days}天前保存`;
}

export default function EditorClient({ id, initialTitle, initialTemplate, initialContent, initialIsPublic, initialSlug, initialUpdatedAtIso }: Props) {
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopQuery,
    getDesktopSnapshot,
    getServerDesktopSnapshot,
  );
  const form = useForm({
    resolver: zodResolver(ResumeContent),
    defaultValues: initialContent,
    mode: "onChange",
  });
  const [title, setTitleState] = useState(initialTitle);
  const [template, setTemplateState] = useState<TemplateId>(resolveTemplateId(initialTemplate));
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicSlug, setPublicSlug] = useState<string | null>(initialSlug);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date>(() => {
    const parsed = initialUpdatedAtIso ? new Date(initialUpdatedAtIso) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  });
  const [now, setNow] = useState(() => new Date());
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<TemplateId | null>(null);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const [isPending, startTransition] = useTransition();
  const previewRootRef = useRef<HTMLDivElement>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>(
    initialContent.sectionOrder ?? [...DEFAULT_SECTION_ORDER]
  );
  const persistResume = useCallback(
    async (content: ResumeContent, resumeTitle: string) => {
      await saveResume(id, content, resumeTitle);
    },
    [id],
  );
  const autosaveForm = useMemo(
    () => ({
      watch: (cb: (data: ResumeContent) => void) =>
        form.watch((data) => cb(data as ResumeContent)),
      getValues: () => form.getValues() as ResumeContent,
    }),
    [form],
  );
  const handleAutosaveError = useCallback((e: unknown) => {
    const message = formatSaveError(e);
    setSaveError(message);
    toast.error(message);
  }, []);
  const handleAutosaveSave = useCallback(
    (content: ResumeContent, resumeTitle: string) =>
      new Promise<void>((resolve, reject) => {
        startTransition(() => {
          persistResume(content, resumeTitle)
            .then(() => {
              setSaveError(null);
              setLastSavedAt(new Date());
              resolve();
            })
            .catch(reject);
        });
      }),
    [persistResume, startTransition],
  );

  const autosave = useResumeAutosave({
    form: autosaveForm,
    resumeId: id,
    title,
    onSave: handleAutosaveSave,
    onError: handleAutosaveError,
  });

  // --- Collab state ---
  const [collabSessionId, setCollabSessionId] = useState<string | null>(null);
  const [collabConfig, setCollabConfig] = useState<{
    roomId: string;
    partyToken: string;
    displayName: string;
    role: "owner" | "mentor";
  } | null>(null);

  // Poll session status when invite is created, connect when mentor joins
  useEffect(() => {
    if (!collabSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function pollStatus() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/collab/session-status?sessionId=${collabSessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "active" && !collabConfig) {
          // Mentor joined! Get owner token and connect
          const tokenRes = await fetch("/api/collab/owner-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: collabSessionId }),
          });
          if (tokenRes.ok) {
            const { partyToken, roomId } = await tokenRes.json();
            setCollabConfig({ roomId, partyToken, displayName: "我", role: "owner" });
            if (timer) { clearInterval(timer); timer = null; }
            toast.success(`导师「${data.mentorName || "匿名"}」已加入协作`);
          }
        }
      } catch { /* ignore network errors */ }
    }

    // Start polling every 3s
    void pollStatus();
    timer = setInterval(pollStatus, 3000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabSessionId, collabConfig]);

  const collabState = useCollabProvider(collabConfig);
  const collabSync = useCollabFormSync({
    ydoc: collabState?.ydoc ?? null,
    form,
    role: "owner",
    enabled: !!collabState?.isConnected,
  });

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        if (source.data.type === "section" && target.data.type === "section") {
          const fromId = source.data.id as string;
          const toId = target.data.id as string;
          setSectionOrder((prev) => {
            const oldIdx = prev.indexOf(fromId);
            const newIdx = prev.indexOf(toId);
            if (oldIdx === -1 || newIdx === -1) return prev;
            const next = arrayMove(prev, oldIdx, newIdx);
            form.setValue("sectionOrder", next, { shouldDirty: true });
            return next;
          });
        }
      },
    });
  }, [form]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function changeTemplate(next: TemplateId) {
    if (pendingTemplateId) return;
    const previous = template;
    setTemplateState(next);
    setPendingTemplateId(next);
    try {
      await setTemplate(id, next);
    } catch (error) {
      console.error("[changeTemplate] failed", error);
      setTemplateState(previous);
      toast.error("切换模板失败，请稍后重试");
    } finally {
      setPendingTemplateId(null);
    }
  }

  async function onToggleShare() {
    if (isTogglingShare) return;
    const next = !isPublic;
    setIsTogglingShare(true);
    try {
      const { slug } = await toggleShare(id, next);
      setIsPublic(next);
      setPublicSlug(slug);
      toast.success(next ? "已开启分享" : "已关闭分享");
    } catch (error) {
      console.error("[toggleShare] failed", error);
      toast.error(next ? "开启分享失败，请稍后重试" : "关闭分享失败，请稍后重试");
    } finally {
      setIsTogglingShare(false);
    }
  }

  function handleOrderChange(newOrder: string[]) {
    setSectionOrder(newOrder);
    form.setValue("sectionOrder", newOrder, { shouldDirty: true });
  }

  /** Check if a section key is a custom (non-built-in) section */
  function isCustomSection(key: string): boolean {
    return !BUILTIN_SECTION_KEYS.has(key);
  }

  async function onExportImage() {
    if (!previewRootRef.current) {
      toast.error("未找到可导出的简历预览");
      return;
    }

    setIsExportingImage(true);
    try {
      await exportPreviewImage({
        root: previewRootRef.current,
        filename: title,
      });
      toast.success("图片已导出");
    } catch {
      toast.error("图片导出失败，请稍后重试");
    } finally {
      setIsExportingImage(false);
    }
  }

  const [splitPercent, setSplitPercent] = useState(50);
  const isDragging = useRef(false);
  const containerWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const container = e.currentTarget.parentElement;
    if (container) containerWidthRef.current = container.clientWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !container) return;
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = Math.min(70, Math.max(30, (x / rect.width) * 100));
      setSplitPercent(pct);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const savedLabel = formatRelativeSaveTime(lastSavedAt, now);
  const isSaving = autosave.status === "saving" || isPending;
  const saveStatusLabel = saveError
    ? "保存失败"
    : isSaving
      ? "保存中"
      : autosave.status === "pending"
        ? "待保存"
        : savedLabel;
  const saveStatusDescription = saveError
    ? `当前自动保存状态：保存失败（${saveError}）`
    : `当前自动保存状态：${saveStatusLabel}`;

  return (
    <FormProvider {...form}>
      {/* Toolbar — only visible on desktop */}
      {isDesktop && (
      <div className="sticky top-14 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Input
            value={title}
            onChange={(e) => setTitleState(e.target.value)}
            className="w-full sm:max-w-xs text-base font-medium"
          />
          <span
            data-testid="autosave-status"
            title={saveStatusDescription}
            className={cn(
              "group relative inline-flex cursor-default items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
              saveError
                ? "bg-destructive/10 text-destructive"
                : isSaving
                  ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                  : autosave.status === "pending"
                    ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                saveError
                  ? "bg-destructive"
                  : isSaving
                    ? "animate-pulse bg-orange-500"
                    : autosave.status === "pending"
                      ? "bg-sky-500"
                    : "bg-emerald-500",
              )}
            />
            {saveStatusLabel}
            <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.4rem)] z-50 hidden w-max max-w-72 -translate-x-1/2 rounded-md bg-popover px-2.5 py-1.5 text-xs font-normal text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover:block">
              {saveStatusDescription}
            </span>
          </span>
          <CompletenessScore />
          <div data-testid="editor-toolbar" className="ml-auto flex flex-wrap items-center gap-2">
            <SmartLayoutButton templateId={template} measureRef={previewRootRef} />
            <Separator orientation="vertical" className="h-6" />
            <StyleEditor
              templateId={template}
              onTemplateChange={changeTemplate}
              pendingTemplateId={pendingTemplateId}
            />
            <Separator orientation="vertical" className="h-6" />
            <ModuleManager sectionOrder={sectionOrder} onOrderChange={handleOrderChange} />
            <Separator orientation="vertical" className="h-6" />
            <Button
              size="sm"
              variant="outline"
              onClick={onToggleShare}
              disabled={isTogglingShare}
              aria-busy={isTogglingShare}
              className="gap-1.5"
            >
              {isTogglingShare ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
              {isTogglingShare
                ? isPublic
                  ? "关闭中"
                  : "开启中"
                : isPublic
                  ? "关闭分享"
                  : "开启分享"}
            </Button>
            {isPublic && publicSlug && (
              <a
                className="self-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                href={`/r/${publicSlug}`}
                target="_blank"
                rel="noreferrer"
              >
                /r/{publicSlug}
              </a>
            )}
            <Separator orientation="vertical" className="h-6" />
            <ExportButton
              resumeId={id}
              filename={title}
              onExportImage={onExportImage}
              isExportingImage={isExportingImage}
            />
            <Separator orientation="vertical" className="h-6" />
            <InviteCollabDialog resumeId={id} onSessionCreated={(sid) => setCollabSessionId(sid)} />
            {collabState?.isConnected && (
              <>
                <Separator orientation="vertical" className="h-6" />
                <PresenceBar users={collabState.presenceUsers} isConnected={collabState.isConnected} />
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Collab activity bar — shown when collab is active */}
      {isDesktop && collabSync.isSyncing && collabSync.changeLog.length > 0 && (
        <div className="border-b border-violet-200 bg-violet-50/50 px-4 py-1.5 dark:border-violet-800 dark:bg-violet-950/30">
          <div className="mx-auto flex max-w-6xl items-center gap-2 text-xs">
            <span className="font-medium text-violet-700 dark:text-violet-300">协作动态</span>
            <span className="text-violet-500 dark:text-violet-400">
              {collabSync.changeLog.slice(-3).map((entry) => (
                <span key={entry.id} className="mr-3">
                  [{new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}]
                  {" "}{entry.author === "mentor" ? "导师" : "你"}修改了「{entry.subfield}」
                </span>
              ))}
            </span>
            <span className="ml-auto text-violet-400">
              共 {collabSync.changeLog.filter(e => e.author === "mentor").length} 处导师修改
            </span>
          </div>
        </div>
      )}

      {isDesktop ? (
        <div className="flex h-[calc(100vh-3.5rem-4rem)]">
          <div
            className="thin-scrollbar space-y-6 overflow-y-auto border-r p-6"
            style={{ width: `${splitPercent}%` }}
          >
            <div className={cn(
              "rounded-lg transition-all duration-500",
              collabSync.highlightedFields.has("basics") && "ring-2 ring-violet-400/60 bg-violet-50/30 dark:bg-violet-950/20"
            )}>
              <BasicsEditor />
            </div>
            {sectionOrder.filter(k => k !== "basics").map((key) => (
              <div key={key} className={cn(
                "rounded-lg transition-all duration-500",
                collabSync.highlightedFields.has(key) && "ring-2 ring-violet-400/60 bg-violet-50/30 dark:bg-violet-950/20"
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
          {/* Resize handle */}
          <div
            className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent active:bg-accent"
            onMouseDown={handleMouseDown}
          >
            <div className="h-8 w-0.5 rounded-full bg-border" />
          </div>
          <div
            className="thin-scrollbar overflow-y-auto bg-muted p-6"
            style={{ width: `${100 - splitPercent}%` }}
          >
            <LivePreview ref={previewRootRef} templateId={template} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">请在电脑端使用简历排版功能</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            简历编辑与排版需要较大屏幕以获得最佳体验，请使用电脑浏览器打开此页面。
          </p>
          <a href="/dashboard" className="mt-2 text-sm font-medium text-primary hover:underline">
            返回我的简历
          </a>
        </div>
      )}
    </FormProvider>
  );
}
