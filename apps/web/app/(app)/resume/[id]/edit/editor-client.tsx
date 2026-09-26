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
import { ResumeContent } from "@intro-builder/shared/schemas";
import { computeCompletenessScore } from "@/lib/completeness-score";
import {
  getResumeVersion,
  listResumeVersions,
  submitResumeVersionRestore,
  toggleShare,
  type ResumeVersionListItem,
  submitResumeMutation,
} from "./actions";
import {
  useResumeMutationSession,
  MutationConflictError,
} from "@/hooks/use-resume-mutation-session";
import { useResumeHistory, type ResumeEditorSnapshot } from "@/hooks/use-resume-history";
import { formatSaveError } from "@/lib/format-save-error";
import { LivePreview } from "@/components/preview/live-preview";
import { ResumeDiffPreview } from "@/components/preview/resume-diff-preview";
import { BasicsEditor } from "@/components/editor/basics-editor";
import { ExperienceEditor } from "@/components/editor/experience-editor";
import { EducationEditor } from "@/components/editor/education-editor";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { ResearchEditor } from "@/components/editor/research-editor";
import { SkillsEditor } from "@/components/editor/skills-editor";
import { BlockSectionEditor } from "@/components/editor/block-section-editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Loader2, Share2, PanelLeftClose, PanelRightClose, PanelRightOpen, MessageSquare, LayoutTemplate, ChevronLeft, PencilLine, CloudCheck, Copy, CircleAlert, CircleHelp, History, Undo2, Redo2 } from "lucide-react";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { DEFAULT_SECTION_ORDER, BUILTIN_SECTION_KEYS } from "@intro-builder/shared/schemas";
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
import { ResumeDiagnoseButton } from "@/components/agent/resume-diagnose-button";
import { AgentModeToggle } from "@/components/agent/agent-mode-toggle";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AgentBubble } from "@/components/agent/agent-bubble";
import { FloatingAgentChat } from "@/components/agent/floating-agent-chat";
import type { AgentOperationApplyResult } from "@/components/agent/agent-operation-apply";
import type { ResumeOperation } from "@intro-builder/shared/types";
import { applyResumeOperation } from "@/lib/agent/apply-operation";
import { VersionHistoryPopover } from "@/components/editor/version-history-popover";
import { EditorOnboarding } from "@/components/editor/editor-onboarding";

type Props = {
  userId: string;
  id: string;
  initialTitle: string;
  initialTemplate: TemplateId;
  initialContent: ResumeContent;
  /**
   * 服务端当前的文档修订号（CAS 条件）。
   * 所有写入都必须携带它；缺失会让并发保护失效。
   */
  initialRevision: number;
  initialIsPublic: boolean;
  initialSlug: string | null;
  // Server passes an ISO string (NOT a Date instance) — Next 16's RSC
  // serializer has dropped Date through the SC → CC boundary in dev, which
  // would crash `lastSavedAt.getTime()` on first render. Strings are safe.
  initialUpdatedAtIso: string;
  // Server-rendered relative time labels must use the same "now" on the
  // client hydration pass; otherwise crossing a minute boundary changes text.
  initialNowIso: string;
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
  agentSurface?: "panel" | "floating";
  from: string | null;
};

type ViewedVersion = {
  id: string;
  title: string;
  templateId: string;
  content: ResumeContent;
  createdAt: string;
  listItem: ResumeVersionListItem;
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

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function EditorClient({ userId, id, initialTitle, initialTemplate, initialContent, initialRevision, initialIsPublic, initialSlug, initialUpdatedAtIso, initialNowIso, initialResolvedTemplate, uploadedTemplates, allTemplates, favoritedTemplateIds = [], agentSurface = "panel", from }: Props) {
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
  /**
   * getRow 在 hook 内部被调用（可能晚于本次渲染），因此必须读 ref 拿到最新值，
   * 否则会把「提交时的标题/模板」算成旧值，产生假的 template/title 变更操作。
   */
  const titleRef = useRef(title);
  const templateRef = useRef(template);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    templateRef.current = template;
  }, [template]);

  /**
   * 标题变化必须安排一次提交。
   *
   * 标题是独立的 React state、**不在表单里**，所以 `form.watch` 不会因为改标题而触发。
   * 旧实现（`use-resume-autosave`）有等价的 title effect，迁移到统一提交时漏掉了，
   * 结果是「改了标题但永远不落盘」—— 相对旧行为的一次回归（实测提交次数 0）。
   *
   * `suppressHistoryCaptureRef` 用于跳过由外部应用快照（恢复历史/撤销）引起的标题
   * 变化：那种情况下内容与 revision 已由统一提交处理，不应再触发第二次提交。
   */
  const previousTitleForSaveRef = useRef(title);
  useEffect(() => {
    if (previousTitleForSaveRef.current === title) return;
    previousTitleForSaveRef.current = title;
    if (suppressHistoryCaptureRef.current) return;
    mutationSessionRef.current?.schedule();
  }, [title]);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicSlug, setPublicSlug] = useState<string | null>(initialSlug);
  const [saveError, setSaveError] = useState<string | null>(null);
  const initialNow = parseIsoDate(initialNowIso) ?? parseIsoDate(initialUpdatedAtIso) ?? new Date(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date>(() => {
    return parseIsoDate(initialUpdatedAtIso) ?? initialNow;
  });
  const [now, setNow] = useState(() => initialNow);
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [paginationData, setPaginationData] = useState<{ pageBreaks: number[]; totalHeight: number } | null>(null);
  const [pendingTemplateId, setPendingTemplateId] = useState<TemplateId | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>("basics");
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [isFloatingAgentDocked, setIsFloatingAgentDocked] = useState(false);
  const [isSharePopoverOpen, setIsSharePopoverOpen] = useState(false);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const [isPending] = useTransition();
  const previewRootRef = useRef<HTMLDivElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>(
    initialContent.sectionOrder ?? [...DEFAULT_SECTION_ORDER]
  );
  const resumeHistory = useResumeHistory({
    title: initialTitle,
    templateId: initialTemplate,
    content: initialContent,
  });
  const suppressHistoryCaptureRef = useRef(false);
  const [versions, setVersions] = useState<ResumeVersionListItem[]>([]);
  const [isVersionPopoverOpen, setIsVersionPopoverOpen] = useState(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [viewedVersion, setViewedVersion] = useState<ViewedVersion | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [onboardingRestartToken, setOnboardingRestartToken] = useState(0);
  const [onboardingVisible, setOnboardingVisible] = useState(false);

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

  const recentTemplateItems = useMemo<TemplatePanelItem[]>(() => {
    const items: TemplatePanelItem[] = [];
    // allTemplates 按 createdAt 升序，倒序遍历取最新 20 条
    for (let i = allTemplates.length - 1; i >= 0 && items.length < 20; i--) {
      const t = allTemplates[i];
      const up = uploadedById.get(t.id);
      if (!up) continue;
      items.push({ id: t.id, name: t.name, resolved: uploadedTemplateToSerializable(t.id, up) });
    }
    return items;
  }, [allTemplates, uploadedById]);

  /**
   * 统一写入会话（P03）。
   *
   * 所有编辑器写入（手动输入、模板切换、恢复、撤销）都经这里提交，因此每条写入
   * 都带 `expectedRevision` 与稳定 `mutationId`。这是「不覆盖他人修改」与
   * 「重试不重复写」的唯一保障。
   *
   * 回执**不会**重置表单：`useResumeMutationSession` 只推进已确认基准，
   * 用户输入始终由 RHF 持有。
   */
  const mutationSession = useResumeMutationSession({
    initial: {
      content: initialContent,
      revision: initialRevision,
      title: initialTitle,
      templateId: String(initialTemplate),
    },
    getContent: () => form.getValues() as ResumeContent,
    getRow: () => ({ title: titleRef.current, templateId: String(templateRef.current) }),
    submit: async (submission) => {
      try {
        const result = await submitResumeMutation({
          resumeId: id,
          mutationId: submission.mutationId,
          expectedRevision: submission.expectedRevision,
          operations: submission.operations,
          // 来源由 session 决定：协作同步会先 setNextSource("collab")，
          // 否则远端改动会被错误归因成「owner 手打的」。
          source: submission.source ?? "manual",
        });
        return result;
      } catch (error) {
        // Server Action 抛错（网络/未知）：交给 hook 记为可重试错误。
        throw error;
      }
    },
    debounceMs: 2000,
  });

  /**
   * 表单变化后安排一次去抖提交。
   *
   * 注意这里**不再**传内容给保存函数：提交时由 session 自己从表单取值并与已确认
   * 基准做差量，因此回执返回不会经过任何「把内容写回表单」的路径。
   */
  useEffect(() => {
    const { unsubscribe } = form.watch(() => {
      mutationSessionRef.current?.schedule();
    });
    return () => unsubscribe();
  }, [form]);

  /** 供表单 watch 引用（effect 需要稳定引用，避免每次渲染重订阅）。 */
  const mutationSessionRef = useRef(mutationSession);
  useEffect(() => {
    mutationSessionRef.current = mutationSession;
  }, [mutationSession]);

  /**
   * 把「已保存」的判定接到新会话上。
   *
   * 这里刻意**不**再并行跑旧的 `useResumeAutosave`：两套写入同时工作会让同一次
   * 编辑产生两条提交（还会有一条不带 revision）。旧 hook 保留给尚未迁移的路径。
   */
  const autosave = {
    /**
     * 冲突必须显示为「未保存」，绝不能因为「曾经发过一次请求」就显示成已保存。
     * `pending` 会让 UI 继续显示「保存中」，比谎报成功安全。
     */
    status:
      mutationSession.status === "saving"
        ? ("saving" as const)
        : mutationSession.status === "idle"
          ? ("idle" as const)
          : mutationSession.status === "pending"
            ? ("pending" as const)
            : ("error" as const),
    flush: mutationSession.flush,
    schedule: mutationSession.schedule,
  };
  const flushEditorAutosave = mutationSession.flush;

  /**
   * 提交成功次数。用它区分「从未保存过」与「刚保存完」。
   *
   * **不能**只看 `status === "idle"`：页面刚挂载、没有任何本地改动时 status 就是
   * idle，那表示「没有待保存」，不表示「刚刚保存成功」。若据此更新保存时间，
   * 用户一打开页面就会看到「刚刚保存」——一次凭空捏造的假状态。
   * 只有在**真的完成过一次提交**之后，idle 才意味着「已保存」。
   */
  const committedCountRef = useRef(0);
  const [committedCount, setCommittedCount] = useState(0);

  useEffect(() => {
    if (mutationSession.committedCount === committedCount) return;
    committedCountRef.current = mutationSession.committedCount;
    setCommittedCount(mutationSession.committedCount);
  }, [mutationSession.committedCount, committedCount]);

  /**
   * 把 session 的状态映射到现有的保存提示 UI。
   *
   * 「已保存」只在**确实完成过一次提交**之后出现；冲突/拒绝/错误一律显示未保存文案。
   */
  useEffect(() => {
    if (mutationSession.status === "conflict") {
      setSaveError("内容已在别处更新，请刷新或比较后再保存");
      return;
    }
    if (mutationSession.status === "rejected") {
      setSaveError(formatSaveError(mutationSession.lastError));
      return;
    }
    if (mutationSession.status === "error") {
      setSaveError(formatSaveError(mutationSession.lastError));
      return;
    }
    if (mutationSession.status === "idle" && committedCountRef.current > 0) {
      setSaveError(null);
      setLastSavedAt(new Date());
    }
  }, [
    mutationSession.status,
    mutationSession.lastError,
    mutationSession.committedCount,
  ]);

  const snapshotFromEditor = useCallback(
    (): ResumeEditorSnapshot => ({
      title,
      templateId: template,
      content: form.getValues() as ResumeContent,
    }),
    [form, template, title],
  );

  const applyEditorSnapshot = useCallback(
    async (
      snapshot: ResumeEditorSnapshot,
      options: { persistTemplate?: boolean; flushAutosave?: boolean } = {},
    ) => {
      const nextContent = ResumeContent.parse(snapshot.content);
      suppressHistoryCaptureRef.current = true;
      setTitleState(snapshot.title);
      setTemplateState(snapshot.templateId as TemplateId);
      form.reset(nextContent);
      setSectionOrder(nextContent.sectionOrder ?? [...DEFAULT_SECTION_ORDER]);
      suppressHistoryCaptureRef.current = false;

      /*
       * 恢复/撤销里的模板变化必须与正文走**同一条**提交路径。
       *
       * 旧实现直接调用 setTemplate action：那条路径不带 revision、不写 mutation 留痕，
       * 于是「恢复了模板但正文没恢复」这种半应用状态无法被发现，也无法被再次撤销。
       * 现在只更新本地状态，由 mutationSession 把「模板 + 正文」的差量作为一次提交发出。
       */
      templateRef.current = snapshot.templateId;
      suppressHistoryCaptureRef.current = true;
      if (options.flushAutosave || options.persistTemplate) {
        try {
          await flushEditorAutosave();
        } catch (error) {
          if (error instanceof MutationConflictError) {
            toast.error("恢复失败：内容已在别处更新，请刷新后重试");
          } else {
            console.error("[applyEditorSnapshot] commit failed", error);
            toast.error("恢复模板状态失败，请稍后重试");
          }
        } finally {
          suppressHistoryCaptureRef.current = false;
        }
      } else {
        suppressHistoryCaptureRef.current = false;
      }
    },
    [flushEditorAutosave, form],
  );

  useEffect(() => {
    const subscription = form.watch(() => {
      if (suppressHistoryCaptureRef.current) return;
      const content = form.getValues() as ResumeContent;
      resumeHistory.capture(
        {
          title,
          templateId: template,
          content,
        },
        { merge: true },
      );
      if (content.sectionOrder) {
        setSectionOrder(content.sectionOrder);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, resumeHistory, template, title]);

  const handleUndo = useCallback(() => {
    const snapshot = resumeHistory.undo();
    if (!snapshot) return;
    void applyEditorSnapshot(snapshot, { persistTemplate: true, flushAutosave: true }).catch(
      (error) => {
        console.error("[handleUndo] autosave flush failed", error);
      },
    );
  }, [applyEditorSnapshot, resumeHistory]);

  const handleRedo = useCallback(() => {
    const snapshot = resumeHistory.redo();
    if (!snapshot) return;
    void applyEditorSnapshot(snapshot, { persistTemplate: true, flushAutosave: true }).catch(
      (error) => {
        console.error("[handleRedo] autosave flush failed", error);
      },
    );
  }, [applyEditorSnapshot, resumeHistory]);

  const loadVersions = useCallback(async () => {
    setIsLoadingVersions(true);
    try {
      setVersions(await listResumeVersions(id));
    } catch (error) {
      console.error("[loadVersions] failed", error);
      toast.error("加载版本历史失败，请稍后重试");
    } finally {
      setIsLoadingVersions(false);
    }
  }, [id]);

  const handleSelectVersion = useCallback(
    async (versionId: string) => {
      try {
        const version = await getResumeVersion(id, versionId);
        const parsed = ResumeContent.safeParse(version.content);
        if (!parsed.success) {
          toast.error("历史版本内容已损坏，无法查看");
          return;
        }
        const listItem =
          versions.find((item) => item.id === versionId) ??
          ({
            id: version.id,
            resumeId: id,
            source: version.source,
            sourceLabel: "历史版本",
            actorName: version.actorName || "我",
            operationCount: version.operationCount || 1,
            summary: version.summary ?? null,
            createdAt: version.createdAt,
          } satisfies ResumeVersionListItem);
        setViewedVersion({
          id: version.id,
          title: version.title,
          templateId: version.templateId,
          content: parsed.data,
          createdAt: version.createdAt,
          listItem,
        });
        setIsVersionPopoverOpen(false);
        setShowTemplatePanel(false);
        setIsAgentMode(false);
        setIsFloatingAgentDocked(false);
      } catch (error) {
        console.error("[handleSelectVersion] failed", error);
        toast.error("打开历史版本失败，请稍后重试");
      }
    },
    [id, versions],
  );

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (isRestoringVersion) return;
      setIsRestoringVersion(true);
      try {
        /*
         * 恢复必须**先提交、后改本地界面**。
         *
         * 旧顺序是「先 setStates/reset 表单 → 再调 action 写库」，于是一旦写库失败
         * （冲突、网络、权限），界面已经显示成历史版本，而服务端还是旧内容 ——
         * 用户以为恢复成功了，刷新后就会「变回去」。
         * 现在由提交模块决定成败：只有拿到 committed 回执才更新本地状态。
         */
        const result = await submitResumeVersionRestore({
          resumeId: id,
          mutationId: `restore_${versionId}_${Date.now().toString(36)}`,
          expectedRevision: mutationSession.getBaseline().revision,
          versionId,
          summary: "恢复历史版本",
        });

        if (result.status === "conflict") {
          toast.error("恢复失败：内容已在别处更新，请刷新后重试");
          return;
        }
        if (result.status === "rejected") {
          toast.error("恢复失败：该历史版本无法恢复");
          return;
        }

        // 只有拿到回执（committed / no_change）才把服务端确认的内容落到本地。
        const parsed = ResumeContent.safeParse(result.status === "committed" ? result.nextContent : undefined);
        const snapshot: ResumeEditorSnapshot | null = parsed.success
          ? {
              title: viewedVersion?.title ?? title,
              templateId: (viewedVersion?.templateId as TemplateId) ?? template,
              content: parsed.data,
            }
          : null;

        if (snapshot) {
          resumeHistory.markBoundary();
          resumeHistory.capture(snapshot, { merge: false });
          await applyEditorSnapshot(snapshot, {});
          mutationSession.applyRemoteCommit({
            content: snapshot.content,
            revision:
              result.status === "committed" ? result.revision : result.currentRevision,
            applyContent: (content) => form.reset(content),
          });
        }
        setViewedVersion(null);
        toast.success("已恢复历史版本");
        void loadVersions();
      } catch (error) {
        console.error("[handleRestoreVersion] failed", error);
        toast.error("恢复历史版本失败，请稍后重试");
      } finally {
        setIsRestoringVersion(false);
      }
    },
    [applyEditorSnapshot, form, id, isRestoringVersion, loadVersions, mutationSession, resumeHistory, template, title, viewedVersion],
  );

  const handleAdjacentVersion = useCallback(
    (direction: "previous" | "next") => {
      if (!viewedVersion) return;
      const currentIndex = versions.findIndex((version) => version.id === viewedVersion.id);
      if (currentIndex === -1) return;
      const nextIndex = direction === "previous" ? currentIndex + 1 : currentIndex - 1;
      const nextVersion = versions[nextIndex];
      if (nextVersion) void handleSelectVersion(nextVersion.id);
    },
    [handleSelectVersion, versions, viewedVersion],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && viewedVersion) {
        event.preventDefault();
        setViewedVersion(null);
        return;
      }
      if (viewedVersion) return;
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        handleRedo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo, viewedVersion]);

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

  const handleEndCollabSession = useCallback(async (sid: string) => {
    const res = await fetch("/api/collab/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "结束协作失败");
    }
    collabState?.sendJson({ type: "session-end" });
    setCollabConfig(null);
    setCollabSessionId(null);
    toast.success("已结束协作");
  }, [collabState]);

  const collabSync = useCollabFormSync({
    ydoc: collabState?.ydoc ?? null,
    form,
    role: "owner",
    enabled: !!collabState?.isConnected,
  });

  /*
   * 协作同步把远端改动写进表单时，必须标注来源（P03 任务 6）。
   *
   * 否则这些改动在提交层会与「用户自己敲的字」无法区分，被记成 manual ——
   * 留痕里就会出现错误的归因（看起来像是 owner 手动改的）。
   * 这里观察同步活动：一旦检测到远端高亮字段，就把下一次提交标为 collab。
   */
  useEffect(() => {
    if (collabSync.highlightedFields.size === 0) return;
    mutationSessionRef.current?.setNextSource("collab");
  }, [collabSync.highlightedFields]);

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
    templateRef.current = next;
    setPendingTemplateId(next);
    try {
      /*
       * 模板切换必须和正文走**同一条**提交路径。
       *
       * 旧实现直接调用 setTemplate action，那条路径不带 revision 也不写留痕，
       * 于是「模板换了、正文没换」这种半应用状态既无法被发现也无法撤销。
       * 现在它是一次普通的 `set_template` 操作，由提交模块在**同一条 SQL**里
       * 更新行与正文快照。
       *
       * 必须先 `schedule()`：模板是独立的 React state、不在表单里，因此
       * `form.watch` 不会触发，`flush()` 会因为「没有待保存改动」而直接返回，
       * 结果就是「界面换了模板、服务端没收到」。
       */
      mutationSession.schedule();
      await mutationSession.flush();
      resumeHistory.markBoundary();
      resumeHistory.capture(
        {
          ...snapshotFromEditor(),
          templateId: next,
        },
        { merge: false },
      );
    } catch (error) {
      // 冲突/失败：把本地模板选择回退到服务端已确认的值，避免 UI 与服务端不一致。
      const baseline = mutationSession.getBaseline();
      setTemplateState(baseline.templateId as TemplateId);
      templateRef.current = baseline.templateId;
      if (error instanceof MutationConflictError) {
        toast.error("模板未保存：内容已在别处更新，请刷新后重试");
      } else {
        console.error("[changeTemplate] failed", error);
        toast.error("切换模板失败，请稍后重试");
      }
      void previous;
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

  function applyAgentOperation(operation: ResumeOperation): AgentOperationApplyResult {
    // Delegate to the pure mapping so create-from-zero inserts (which may need
    // brand-new array items) and updates both apply consistently.
    const current = form.getValues() as unknown as ResumeContent;
    const beforeAgentSnapshot = ResumeContent.parse(current);
    const result = applyResumeOperation(current, operation);
    if (!result) {
      toast.error("这条 Agent 建议暂不支持自动应用");
      return { ok: false };
    }

    type SetValueArgs = Parameters<typeof form.setValue>;
    const restoreChangedKeys = (content: ResumeContent) => {
      suppressHistoryCaptureRef.current = true;
      try {
        for (const key of result.changedKeys) {
          form.setValue(
            key as SetValueArgs[0],
            (content as Record<string, unknown>)[key] as SetValueArgs[1],
            { shouldDirty: true, shouldValidate: true },
          );
        }
      } finally {
        suppressHistoryCaptureRef.current = false;
      }
      if (result.changedKeys.includes("sectionOrder")) {
        setSectionOrder(content.sectionOrder ?? [...DEFAULT_SECTION_ORDER]);
      }
    };

    const applyChangedKeys = () => {
      suppressHistoryCaptureRef.current = true;
      try {
        for (const key of result.changedKeys) {
          form.setValue(
            key as SetValueArgs[0],
            (result.content as Record<string, unknown>)[key] as SetValueArgs[1],
            { shouldDirty: true, shouldValidate: true },
          );
        }
      } finally {
        suppressHistoryCaptureRef.current = false;
      }
      if (result.changedKeys.includes("sectionOrder")) {
        setSectionOrder(result.content.sectionOrder);
      }
    };

    try {
      applyChangedKeys();
    } catch (error) {
      try {
        restoreChangedKeys(beforeAgentSnapshot);
      } catch (rollbackError) {
        console.error("[applyAgentOperation] rollback after local apply failed", rollbackError);
      }
      throw error;
    }

    return {
      ok: true,
      rollback: () => {
        restoreChangedKeys(beforeAgentSnapshot);
      },
      commit: () => {
        /*
         * Agent 应用后的持久化**只经统一提交**（P03 任务 4）。
         *
         * 旧实现在这里额外调用一次 `createResumeVersion`，而上面对表单的
         * `setValue` 已经会触发提交。结果是**同一次操作两次写入**：
         * 一条是带 revision 的正规提交，另一条是绕过 revision、不参与幂等的
         * 独立留痕；两者互不知晓，历史里会出现重复条目，并发下还会产生
         * 「正文 revision 与留痕版本对不上」的错位。
         *
         * 现在这里只做两件不写库的事：标记历史边界、把 Agent 的内容写进历史栈。
         * 落盘、修订快照与 outbox 事件由 commitResumeMutation 的 CTE 一次性完成，
         * 因此这次修改天然出现在版本历史里（source=agent）。
         */
        const snapshot: ResumeEditorSnapshot = {
          title,
          templateId: template,
          content: result.content,
        };
        resumeHistory.markBoundary();
        resumeHistory.capture(snapshot, { merge: false });
        const versionSummary = operation.changeSummary || operation.label || "Agent 修改简历";
        // 触发一次显式提交：Agent 的改动必须立刻落盘，而不是等 2 秒去抖。
        mutationSession.schedule();
        void mutationSession
          .flush()
          .then(() => {
            /*
             * 用**提交回执**驱动「查看差异」，而不是自己再造一条版本记录。
             *
             * 回执里的 versionId 就是这次提交在服务端留下的修订快照，因此
             * 差异视图展示的正是服务端真实保存下来的那一版 —— 与历史列表同源。
             * 若没有回执（提交被拒/冲突），这里不发成功提示，也不伪造版本 id。
             */
            const receipt = mutationSessionRef.current?.getLastReceipt();
            if (!receipt) return;
            toast.success("已生成版本，可查看对比", {
              action: {
                label: "查看差异",
                onClick: () => {
                  setViewedVersion({
                    id: receipt.versionId,
                    title,
                    templateId: template,
                    content: beforeAgentSnapshot,
                    createdAt: receipt.committedAt,
                    listItem: {
                      id: receipt.versionId,
                      resumeId: id,
                      source: "agent",
                      sourceLabel: "通过对话",
                      actorName: "我",
                      operationCount: 1,
                      summary: versionSummary,
                      createdAt: receipt.committedAt,
                    },
                  });
                  setIsVersionPopoverOpen(false);
                  setShowTemplatePanel(false);
                  setIsAgentMode(false);
                  setIsFloatingAgentDocked(false);
                },
              },
            });
            void loadVersions();
          })
          .catch((error) => {
            if (error instanceof MutationConflictError) {
              toast.error("Agent 修改未保存：内容已在别处更新，请刷新后重试");
            } else {
              console.error("[applyAgentOperation] commit failed", error);
              toast.error("Agent 修改未能保存，请稍后重试");
            }
          });
      },
    };
  }

  function flushAgentAutosave() {
    return flushEditorAutosave();
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
  const agentCompleteness = computeCompletenessScore(form.getValues() as ResumeContent);
  const useFloatingAgent = agentSurface === "floating";
  const showAgentInEditorColumn =
    (!useFloatingAgent && isAgentMode) ||
    (useFloatingAgent && isFloatingAgentDocked);
  const floatingAgentChat = (
    <FloatingAgentChat
      resumeId={id}
      title={title}
      templateId={template}
      getResumeContent={() => form.getValues() as ResumeContent}
      completeness={agentCompleteness}
      applyOperation={applyAgentOperation}
      flushAutosave={flushAgentAutosave}
    />
  );

  return (
    <FormProvider {...form}>
      {/* Toolbar — only visible on desktop */}
      {isDesktop && (
      <div className="sticky top-14 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <TooltipProvider>
        <div
          data-testid="editor-toolbar"
          data-editor-onboarding-target="toolbar"
          className="flex items-center gap-1.5 px-4 pb-1.5 pt-0.5"
        >
          {/* ── 左组：导航 + 工具 ── */}
          <a
            href={backHref}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {backLabel}
          </a>
          <div className="h-4 w-[2px] self-center rounded-full bg-border" />
          {viewedVersion ? (
            <>
              <div className="rounded-md bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                正在查看历史版本，编辑工具已锁定
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setViewedVersion(null)}
                aria-label="退出版本对比"
                className="gap-1.5"
              >
                退出对比
              </Button>
            </>
          ) : (
            <>
              {/* 历史操作：图标按钮，靠 tooltip 承担语义，省下顶栏横向空间 */}
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={handleUndo}
                        disabled={!resumeHistory.canUndo}
                        aria-label="撤销"
                      />
                    }
                  >
                    <Undo2 className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>撤销</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={handleRedo}
                        disabled={!resumeHistory.canRedo}
                        aria-label="重做"
                      />
                    }
                  >
                    <Redo2 className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>重做</TooltipContent>
                </Tooltip>
                <div className="relative">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label="版本历史"
                          onClick={() => {
                            const nextOpen = !isVersionPopoverOpen;
                            setIsVersionPopoverOpen(nextOpen);
                            if (nextOpen) void loadVersions();
                          }}
                          className={cn(
                            isVersionPopoverOpen &&
                              "bg-primary/5 font-semibold text-primary hover:bg-primary/10 hover:text-primary dark:bg-primary/15 dark:hover:bg-primary/20",
                          )}
                        />
                      }
                    >
                      <History className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>版本历史</TooltipContent>
                  </Tooltip>
                  {isVersionPopoverOpen ? (
                    <div className="absolute left-0 top-full z-50 mt-1">
                      <VersionHistoryPopover
                        versions={versions}
                        activeVersionId={null}
                        isLoading={isLoadingVersions}
                        onSelectVersion={handleSelectVersion}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="h-4 w-[2px] self-center rounded-full bg-border" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAgentMode(false);
                  setIsFloatingAgentDocked(false);
                  setShowTemplatePanel((v) => !v);
                }}
                aria-pressed={showTemplatePanel}
                className={cn(
                  "gap-1.5",
                  showTemplatePanel && "bg-primary/5 font-semibold text-primary hover:bg-primary/10 hover:text-primary dark:bg-primary/15 dark:hover:bg-primary/20",
                )}
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                模板
              </Button>
              <StyleEditor />
              <SmartLayoutButton templateId={template} measureRef={previewRootRef} />
              <ModuleManager sectionOrder={sectionOrder} onOrderChange={handleOrderChange} />
              <ResumeDiagnoseButton resumeId={id} />
              {!useFloatingAgent ? (
                <AgentModeToggle
                  active={isAgentMode}
                  onClick={() => {
                    setShowTemplatePanel(false);
                    setIsAgentMode((value) => !value);
                  }}
                />
              ) : null}
            </>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="新手引导"
            className="gap-1.5"
            onClick={() => setOnboardingRestartToken((current) => current + 1)}
          >
            <CircleHelp className="h-3.5 w-3.5" />
            新手引导
          </Button>

          {collabState?.isConnected && (
            <>
              <div className="h-4 w-[2px] self-center rounded-full bg-border" />
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
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="relative flex h-8 w-56 shrink-0 items-center justify-end overflow-hidden">
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
                  className="h-8 w-full animate-in fade-in zoom-in-95 duration-150 border-primary text-[0.8rem] font-medium focus-visible:border-primary focus-visible:ring-0 md:text-[0.8rem]"
                />
              ) : (
                <div className="flex min-w-0 animate-in fade-in slide-in-from-right-1 items-center justify-end gap-2 duration-150">
                  {!viewedVersion ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(true)}
                      aria-label="重命名"
                      className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-muted-foreground"
                    >
                      <PencilLine className="h-3 w-3" />
                    </button>
                  ) : null}
                  <span className="max-w-[200px] truncate text-[0.8rem] font-medium text-foreground">
                    {title || "未命名简历"}
                  </span>
                </div>
              )}
            </div>
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
                  <CloudCheck className="h-4 w-4" />
                )}
                <span className="sr-only">{saveStatusLabel}</span>
              </TooltipTrigger>
              <TooltipContent>{saveStatusDescription}</TooltipContent>
            </Tooltip>
          </div>

          <div className="h-4 w-[2px] self-center rounded-full bg-border" />
          <CompletenessScore />
          <div className="h-4 w-[2px] self-center rounded-full bg-border" />

          {/* ── 分享：icon + popover(链接可复制) ── */}
          <Popover open={isSharePopoverOpen} onOpenChange={setIsSharePopoverOpen}>
            <PopoverTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="公开分享"
                  title="公开分享"
                  className={cn(
                    "h-8 w-8",
                    isSharePopoverOpen && !isPublic && "bg-primary/5 font-semibold text-primary hover:bg-primary/10 hover:text-primary aria-expanded:!bg-primary/5 aria-expanded:!text-primary dark:bg-primary/15 dark:hover:bg-primary/20 dark:aria-expanded:!bg-primary/15",
                    isPublic && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                  )}
                />
              }
            >
              {isTogglingShare ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              {isPublic && publicSlug ? (
                <>
                  <PopoverHeader>
                    <PopoverTitle className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      公开分享已开启
                    </PopoverTitle>
                    <PopoverDescription className="text-xs">任何人凭此链接可查看只读简历（不可编辑）。</PopoverDescription>
                  </PopoverHeader>
                  <div className="flex items-center overflow-hidden rounded-lg border border-border bg-muted/40">
                    <input
                      readOnly
                      value={shareUrl}
                      className="min-w-0 flex-1 truncate bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground outline-none"
                    />
                    <button
                      type="button"
                      onClick={onCopyShareLink}
                      className="flex h-8 shrink-0 items-center gap-1 border-l border-border px-2.5 text-xs font-medium text-primary transition-colors hover:bg-accent"
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
                    className="w-full text-xs text-destructive hover:text-destructive"
                  >
                    {isTogglingShare ? "处理中…" : "关闭分享"}
                  </Button>
                </>
              ) : (
                <>
                  <PopoverHeader>
                    <PopoverTitle className="text-sm">公开分享</PopoverTitle>
                    <PopoverDescription className="text-xs">开启后生成只读链接，任何人可凭链接查看你的简历。</PopoverDescription>
                  </PopoverHeader>
                  <Button
                    size="sm"
                    onClick={onToggleShare}
                    disabled={isTogglingShare}
                    className="w-full gap-1.5 text-xs"
                  >
                    {isTogglingShare ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                    开启分享
                  </Button>
                </>
              )}
            </PopoverContent>
          </Popover>

          <InviteCollabDialog resumeId={id} onSessionCreated={(sid) => setCollabSessionId(sid)} isActive={collabSessionId !== null} sessionId={collabSessionId} onEndSession={handleEndCollabSession} />
          <ExportButton
            resumeId={id}
            filename={title}
            onExportImage={onExportImage}
            isExportingImage={isExportingImage}
            paginationData={paginationData}
          />
        </div>
        </TooltipProvider>
      </div>
      )}

      {isDesktop ? (
        <EditorOnboarding
          userId={userId}
          restartToken={onboardingRestartToken}
          onVisibilityChange={setOnboardingVisible}
        />
      ) : null}

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

      {isDesktop ? viewedVersion ? (
        <div
          className={cn(
            "overflow-hidden",
            onboardingVisible
              ? "h-[calc(100vh-3.5rem-4rem-5rem)]"
              : "h-[calc(100vh-3.5rem-4rem)]",
          )}
        >
          <ResumeDiffPreview
            oldContent={viewedVersion.content}
            newContent={(form.getValues() as ResumeContent)}
            viewedVersion={viewedVersion.listItem}
            versions={versions}
            onSelectVersion={handleSelectVersion}
            onRestore={handleRestoreVersion}
            onClose={() => setViewedVersion(null)}
            onPreviousVersion={() => handleAdjacentVersion("previous")}
            onNextVersion={() => handleAdjacentVersion("next")}
            canPreviousVersion={
              versions.findIndex((version) => version.id === viewedVersion.id) >= 0 &&
              versions.findIndex((version) => version.id === viewedVersion.id) < versions.length - 1
            }
            canNextVersion={versions.findIndex((version) => version.id === viewedVersion.id) > 0}
          />
        </div>
      ) : (
        <div
          className={cn(
            "flex overflow-hidden",
            onboardingVisible
              ? "h-[calc(100vh-3.5rem-4rem-5rem)]"
              : "h-[calc(100vh-3.5rem-4rem)]",
          )}
        >
          <div
            data-editor-onboarding-target="editor"
            className="relative min-w-0 border-r"
            style={{ flex: `0 0 ${splitPercent}%` }}
          >
            <div
              ref={editorPanelRef}
              className={cn(
                "thin-scrollbar editor-panel h-full overflow-y-auto overflow-x-hidden bg-background",
                showAgentInEditorColumn ? "p-0" : "p-3.5",
              )}
            >
              {isAgentMode && !useFloatingAgent ? (
                <AgentPanel
                  resumeId={id}
                  title={title}
                  templateId={template}
                  getResumeContent={() => form.getValues() as ResumeContent}
                  completeness={agentCompleteness}
                  applyOperation={applyAgentOperation}
                  flushAutosave={flushAgentAutosave}
                  onBackToEdit={() => setIsAgentMode(false)}
                />
              ) : useFloatingAgent && isFloatingAgentDocked ? (
                <section
                  role="region"
                  aria-label="AI 简历助手对话面板"
                  className="flex h-full flex-col bg-background"
                >
                  <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">AI 简历助手</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="返回表单编辑"
                      onClick={() => setIsFloatingAgentDocked(false)}
                      className="h-8 w-8"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {floatingAgentChat}
                  </div>
                </section>
              ) : (
              <div className="space-y-4">
                <div className={cn(
                  "rounded-lg transition-all duration-500",
                  collabSync.highlightedFields.has("basics") && "ring-2 ring-violet-400/60 bg-violet-50/30 dark:bg-violet-950/20"
                )} onClick={() => setActiveSection("basics")}>
                  <BasicsEditor isActive={activeSection === "basics"} />
                </div>
                {sectionOrder.filter(k => k !== "basics").map((key) => (
                  <div key={key} className={cn(
                    "rounded-lg transition-all duration-500",
                    collabSync.highlightedFields.has(key) && "ring-2 ring-violet-400/60 bg-violet-50/30 dark:bg-violet-950/20"
                  )} onClick={() => setActiveSection(key)}>
                    <SectionWrapper id={key} isActive={activeSection === key}>
                      {key === "experience" && <ExperienceEditor resumeId={id} />}
                      {key === "education" && <EducationEditor resumeId={id} />}
                      {key === "projects" && <ProjectsEditor resumeId={id} />}
                      {key === "research" && <ResearchEditor resumeId={id} />}
                      {key === "skills" && <SkillsEditor resumeId={id} />}
                      {key === "summary" && <BlockSectionEditor field="summary" placeholder="一段话概括你的背景、优势与求职意向…" />}
                      {key === "awards" && <BlockSectionEditor field="awards" placeholder="如：2024 年国家奖学金&#10;ACM 区域赛银奖" />}
                      {key === "portfolio" && <BlockSectionEditor field="portfolio" placeholder="放作品名称 + 链接 + 一句话说明…" />}
                      {isCustomSection(key) && <CustomSectionEditor sectionId={key} resumeId={id} />}
                    </SectionWrapper>
                  </div>
                ))}
              </div>
              )}
            </div>
            {/* 模板面板：覆盖左侧表单列（右侧预览常驻可见，换模板实时看效果）。
                表单不卸载（仅被遮住），保留编辑状态与滚动位置。
                点击右侧预览区域(backdrop)关闭面板。 */}
            {showTemplatePanel && !showAgentInEditorColumn && (
              <>
                <TemplateSwitchPanel
                  className="absolute inset-0 z-20"
                  favorites={favoriteTemplateItems}
                  recent={recentTemplateItems}
                  currentTemplateId={template}
                  pendingTemplateId={pendingTemplateId}
                  previewContent={form.getValues() as ResumeContent}
                  onApply={changeTemplate}
                  onClose={() => setShowTemplatePanel(false)}
                />
              </>
            )}
          </div>
          {/* Resize handle */}
          {!showAgentInEditorColumn && (
            <div
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              onMouseDown={handleMouseDown}
            >
              <div className="h-8 w-1 rounded-full bg-border transition-all duration-200 group-hover:h-12 group-hover:bg-muted-foreground/50 group-active:bg-primary/60" />
            </div>
          )}
          <div
            data-preview-scroll-pane=""
            data-editor-onboarding-target="preview"
            className="thin-scrollbar min-w-0 overflow-auto overscroll-contain bg-muted p-6"
            style={{ flex: `1 1 ${100 - splitPercent}%` }}
            onClick={showTemplatePanel ? () => setShowTemplatePanel(false) : undefined}
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
          {!useFloatingAgent ? (
            <Button type="button" onClick={() => setIsAgentMode(true)}>
              打开 Agent
            </Button>
          ) : null}
          {!useFloatingAgent ? (
            <Sheet open={isAgentMode} onOpenChange={setIsAgentMode}>
              <SheetContent side="bottom" className="h-[88vh] gap-0 p-0" showCloseButton={false}>
                <SheetHeader className="sr-only">
                  <SheetTitle>简历 Agent</SheetTitle>
                  <SheetDescription>
                    移动端 Agent 面板，修改简历前仍需确认。
                  </SheetDescription>
                </SheetHeader>
                <AgentPanel
                  resumeId={id}
                  title={title}
                  templateId={template}
                  getResumeContent={() => form.getValues() as ResumeContent}
                  completeness={agentCompleteness}
                  applyOperation={applyAgentOperation}
                  flushAutosave={flushAgentAutosave}
                  onBackToEdit={() => setIsAgentMode(false)}
                />
              </SheetContent>
            </Sheet>
          ) : null}
        </div>
      )}
      {useFloatingAgent && !isFloatingAgentDocked ? (
        <AgentBubble
          title="AI 简历助手"
          onDockToPanel={() => {
            setShowTemplatePanel(false);
            setIsFloatingAgentDocked(true);
          }}
        >
          {floatingAgentChat}
        </AgentBubble>
      ) : null}
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
