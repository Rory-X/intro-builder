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
import { ResearchEditor } from "@/components/editor/research-editor";
import { SkillsEditor } from "@/components/editor/skills-editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Share2, PanelRightClose, PanelRightOpen, MessageSquare, LayoutTemplate, ChevronLeft, Pencil, Check, Copy, CircleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AllTemplatesItem, TemplateId } from "@/lib/templates/registry";
import {
  uploadedTemplateToSerializable,
  type SerializableResolvedTemplate,
} from "@/lib/templates/render";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { SectionWrapper } from "@/components/editor/section-wrapper";
import { ModuleManager } from "@/components/editor/module-manager";
import { CustomSectionEditor } from "@/components/editor/custom-section-editor";
import { StyleEditor } from "@/components/editor/style-editor";
import { TemplateSwitchPanel, type TemplatePanelItem } from "@/components/editor/template-switch-panel";
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
import { useAnnotations } from "@/hooks/use-annotations";
import { PresenceBar } from "@/components/collab/presence-bar";
import { VoiceChatControls } from "@/components/collab/voice-chat-controls";
import { AnnotationHighlights, flashAnnotation } from "@/components/collab/annotation-highlights";
import { AnnotationList } from "@/components/collab/annotation-list";

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
  // Pre-resolved template + the full set of uploaded templates so the
  // client preview can dispatch built-in vs uploaded without a round
  // trip on each template switch. Required because every code path that
  // mounts EditorClient (server route, tests) must supply both — leaving
  // them optional silently hides a real bundle on uploaded templates if
  // a future caller forgets to pass them.
  initialResolvedTemplate: SerializableResolvedTemplate;
  uploadedTemplates: UploadedTemplate[];
  /**
   * Pre-merged list of every selectable template (built-in + uploaded) for
   * the StyleEditor's picker UI. The page owns this fetch (server side), so
   * the editor can render the gallery synchronously and stay client-only.
   */
  allTemplates: AllTemplatesItem[];
  /**
   * 当前用户收藏的 templateId 列表（编辑器内模板面板的「已收藏」置顶分组）。
   * 可选，缺省 [] —— 老调用方/测试不传也不报错，只是没有收藏分组。
   */
  favoritedTemplateIds?: string[];
  from: string | null;
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
  return true; // Assume desktop for SSR (this page is desktop-only)
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

export default function EditorClient({ id, initialTitle, initialTemplate, initialContent, initialIsPublic, initialSlug, initialUpdatedAtIso, initialResolvedTemplate, uploadedTemplates, allTemplates, favoritedTemplateIds = [], from }: Props) {
  const backHref = from === "templates" ? "/templates" : "/dashboard";
  const backLabel = from === "templates" ? "模板库" : "我的简历";
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
  const [template, setTemplateState] = useState<TemplateId>(initialTemplate);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicSlug, setPublicSlug] = useState<string | null>(initialSlug);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date>(() => {
    const parsed = initialUpdatedAtIso ? new Date(initialUpdatedAtIso) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  });
  const [now, setNow] = useState(() => new Date());
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [paginationData, setPaginationData] = useState<{ pageBreaks: number[]; totalHeight: number } | null>(null);
  const [pendingTemplateId, setPendingTemplateId] = useState<TemplateId | null>(null);
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const [isPending, startTransition] = useTransition();
  const previewRootRef = useRef<HTMLDivElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>(
    initialContent.sectionOrder ?? [...DEFAULT_SECTION_ORDER]
  );

  // Map of id → UploadedTemplate for instant client-side lookup when the
  // user switches template.
  const uploadedById = useMemo(() => {
    const map = new Map<string, UploadedTemplate>();
    for (const t of uploadedTemplates) {
      map.set(t.id, t);
    }
    return map;
  }, [uploadedTemplates]);

  // Project the current `template` selection into a serializable form
  // <LivePreview> can dispatch on. If the id is no longer in the preloaded DB
  // list, keep rendering the server-resolved fallback instead of inventing a
  // client-side template.
  const resolvedTemplate = useMemo<SerializableResolvedTemplate>(() => {
    if (initialResolvedTemplate.id === template) {
      return initialResolvedTemplate;
    }
    const uploaded = uploadedById.get(template);
    if (uploaded) {
      return uploadedTemplateToSerializable(uploaded.id, uploaded);
    }
    return initialResolvedTemplate;
  }, [template, uploadedById, initialResolvedTemplate]);

  // 模板面板只展示「我收藏的模板」。从 allTemplates 解析出可渲染的 resolved，
  // 所有模板都来自 DB published 行并走统一 SlotRenderer 路径。
  const favoriteTemplateItems = useMemo<TemplatePanelItem[]>(() => {
    const favSet = new Set(favoritedTemplateIds);
    const seen = new Set<string>();
    const items: TemplatePanelItem[] = [];
    for (const t of allTemplates) {
      if (seen.has(t.id) || !favSet.has(t.id)) continue;
      let resolved: SerializableResolvedTemplate;
      const up = uploadedById.get(t.id);
      if (up) {
        resolved = uploadedTemplateToSerializable(t.id, up);
      } else {
        continue; // 孤儿（DB 里没有了）
      }
      seen.add(t.id);
      items.push({ id: t.id, name: t.name, resolved });
    }
    return items;
  }, [allTemplates, favoritedTemplateIds, uploadedById]);
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
  }, [collabSessionId, collabConfig]);

  const collabState = useCollabProvider(collabConfig);
  const collabSync = useCollabFormSync({
    ydoc: collabState?.ydoc ?? null,
    form,
    role: "owner",
    enabled: !!collabState?.isConnected,
  });

  // Annotations for comment mode (owner sees mentor's annotations)
  const { annotations: collabAnnotations, updateStatus: updateAnnotationStatus } = useAnnotations({
    ydoc: collabState?.ydoc ?? null,
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

  // Auto-scroll the editor panel when dragging sections near edges
  useEffect(() => {
    const el = editorPanelRef.current;
    if (!el) return;
    return autoScrollForElements({ element: el });
  }, []);

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

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const shareUrl =
    publicSlug && typeof window !== "undefined"
      ? `${window.location.origin}/r/${publicSlug}`
      : publicSlug
        ? `/r/${publicSlug}`
        : "";
  const onCopyShareLink = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard
      ?.writeText(shareUrl)
      .then(() => toast.success("链接已复制"))
      .catch(() => toast.error("复制失败"));
  }, [shareUrl]);

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
        <TooltipProvider>
        <div
          data-testid="editor-toolbar"
          className="flex items-center gap-2 px-6 py-2.5"
        >
          {/* ── 左组：导航 + 工具 ── */}
          <a
            href={backHref}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {backLabel}
          </a>
          <Separator orientation="vertical" className="h-5" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTemplatePanel((v) => !v)}
            aria-pressed={showTemplatePanel}
            className={cn(
              "gap-1.5",
              showTemplatePanel && "border-primary bg-primary/5 text-primary",
            )}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            模板
          </Button>
          <StyleEditor />
          <SmartLayoutButton templateId={template} measureRef={previewRootRef} />
          <ModuleManager sectionOrder={sectionOrder} onOrderChange={handleOrderChange} />

          {collabState?.isConnected && (
            <>
              <Separator orientation="vertical" className="h-6" />
              <VoiceChatControls
                provider={collabState.provider}
                enabled={collabState.presenceUsers.length >= 2}
              />
              <PresenceBar users={collabState.presenceUsers} isConnected={collabState.isConnected} />
            </>
          )}

          {/* ── 弹簧 ── */}
          <div className="flex-1" />

          {/* ── 右组：简历名(铅笔编辑) + 保存图标 ── */}
          <div className="flex shrink-0 items-center gap-1">
            {isEditingTitle ? (
              <Input
                ref={titleInputRef}
                value={title}
                onChange={(e) => setTitleState(e.target.value)}
                onBlur={() => setIsEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") setIsEditingTitle(false);
                }}
                aria-label="简历名称"
                className="h-8 w-48 text-sm font-medium"
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  aria-label="重命名"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  title="点击重命名"
                  className="max-w-[200px] truncate rounded-md px-1 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {title || "未命名简历"}
                </button>
              </>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    data-testid="autosave-status"
                    title={saveStatusDescription}
                    className={cn(
                      "ml-0.5 inline-flex h-6 w-6 cursor-default items-center justify-center rounded-full",
                      saveError
                        ? "text-destructive"
                        : isSaving
                          ? "text-orange-500"
                          : autosave.status === "pending"
                            ? "text-sky-500"
                            : "text-emerald-500",
                    )}
                  />
                }
              >
                {saveError ? (
                  <CircleAlert className="h-4 w-4" />
                ) : isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : autosave.status === "pending" ? (
                  <Loader2 className="h-4 w-4" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span className="sr-only">{saveStatusLabel}</span>
              </TooltipTrigger>
              <TooltipContent>{saveStatusDescription}</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-5" />
          <CompletenessScore />
          <Separator orientation="vertical" className="h-5" />

          {/* ── 分享：icon + popover(链接可复制) ── */}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="公开分享"
                  title="公开分享"
                  className={cn(
                    "h-8 w-8",
                    isPublic && "bg-primary/10 text-primary hover:bg-primary/15",
                  )}
                />
              }
            >
              {isTogglingShare ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              {isPublic && publicSlug ? (
                <>
                  <PopoverHeader>
                    <PopoverTitle className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      公开分享已开启
                    </PopoverTitle>
                    <PopoverDescription>任何人凭此链接可查看只读简历（不可编辑）。</PopoverDescription>
                  </PopoverHeader>
                  <div className="flex items-center overflow-hidden rounded-md border border-border bg-muted/40">
                    <input
                      readOnly
                      value={shareUrl}
                      className="min-w-0 flex-1 truncate bg-transparent px-2.5 py-2 text-xs text-muted-foreground outline-none"
                    />
                    <button
                      type="button"
                      onClick={onCopyShareLink}
                      className="flex h-9 shrink-0 items-center gap-1 border-l border-border px-3 text-xs font-medium text-primary transition-colors hover:bg-accent"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      复制
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onToggleShare}
                    disabled={isTogglingShare}
                    className="w-full text-destructive hover:text-destructive"
                  >
                    {isTogglingShare ? "处理中…" : "关闭分享"}
                  </Button>
                </>
              ) : (
                <>
                  <PopoverHeader>
                    <PopoverTitle>公开分享</PopoverTitle>
                    <PopoverDescription>开启后生成只读链接，任何人可凭链接查看你的简历。</PopoverDescription>
                  </PopoverHeader>
                  <Button
                    size="sm"
                    onClick={onToggleShare}
                    disabled={isTogglingShare}
                    className="w-full gap-1.5"
                  >
                    {isTogglingShare ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                    开启分享
                  </Button>
                </>
              )}
            </PopoverContent>
          </Popover>

          <InviteCollabDialog resumeId={id} onSessionCreated={(sid) => setCollabSessionId(sid)} />
          <ExportButton
            resumeId={id}
            filename={title}
            onExportImage={onExportImage}
            isExportingImage={isExportingImage}
            paginationData={paginationData}
          />
          <Separator orientation="vertical" className="h-5" />
          <ThemeToggle />
        </div>
        </TooltipProvider>
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
        <div className="flex h-[calc(100vh-3.5rem-4rem)] overflow-hidden">
          <div className="relative min-w-0 border-r" style={{ flex: `0 0 ${splitPercent}%` }}>
            <div
              ref={editorPanelRef}
              className="thin-scrollbar h-full space-y-6 overflow-y-auto p-6"
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
                    {key === "research" && <ResearchEditor />}
                    {key === "skills" && <SkillsEditor />}
                    {isCustomSection(key) && <CustomSectionEditor sectionId={key} />}
                  </SectionWrapper>
                </div>
              ))}
            </div>
            {/* 模板面板：覆盖左侧表单列（右侧预览常驻可见，换模板实时看效果）。
                表单不卸载（仅被遮住），保留编辑状态与滚动位置。 */}
            {showTemplatePanel && (
              <TemplateSwitchPanel
                className="absolute inset-0 z-20"
                favorites={favoriteTemplateItems}
                currentTemplateId={template}
                pendingTemplateId={pendingTemplateId}
                previewContent={form.getValues() as ResumeContent}
                onApply={changeTemplate}
                onClose={() => setShowTemplatePanel(false)}
              />
            )}
          </div>
          {/* Resize handle */}
          <div
            className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent active:bg-accent"
            onMouseDown={handleMouseDown}
          >
            <div className="h-8 w-0.5 rounded-full bg-border" />
          </div>
          <div
            className="thin-scrollbar min-w-0 overflow-y-auto bg-muted p-6"
            style={{ flex: `1 1 ${100 - splitPercent}%` }}
          >
            <LivePreview ref={previewRootRef} resolvedTemplate={resolvedTemplate} />
            {/* Annotation highlights on preview (when collab active) */}
            {collabAnnotations.length > 0 && (
              <AnnotationHighlights
                previewRef={previewRootRef}
                annotations={collabAnnotations}
                canManage
                onUpdateStatus={updateAnnotationStatus}
              />
            )}
          </div>
          {/* Collapsible annotation panel */}
          {collabAnnotations.length > 0 && (
            <AnnotationPanel
              annotations={collabAnnotations}
              onUpdateStatus={updateAnnotationStatus}
            />
          )}
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

/** Collapsible annotation panel for owner */
function AnnotationPanel({
  annotations,
  onUpdateStatus,
}: {
  annotations: import("@/hooks/use-annotations").Annotation[];
  onUpdateStatus: (id: string, status: "accepted" | "dismissed") => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pendingCount = annotations.filter((a) => a.status === "pending").length;

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 border-l bg-background px-2 py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 hover:bg-accent"
          title="展开批注面板"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center gap-1">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          {pendingCount > 0 && (
            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
              {pendingCount}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scrollbar w-[280px] shrink-0 overflow-y-auto border-l bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3 py-2">
        <span className="text-xs font-medium">批注 ({annotations.length})</span>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 hover:bg-accent"
          title="收起面板"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3">
        <AnnotationList
          annotations={annotations}
          canManage
          onUpdateStatus={onUpdateStatus}
          onClickAnnotation={(ann) => flashAnnotation(ann.id)}
        />
      </div>
    </div>
  );
}
