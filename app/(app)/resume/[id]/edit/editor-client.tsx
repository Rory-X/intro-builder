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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Download, Share2 } from "lucide-react";
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

type Props = {
  id: string;
  initialTitle: string;
  initialTemplate: TemplateId;
  initialContent: ResumeContent;
  initialIsPublic: boolean;
  initialSlug: string | null;
  initialUpdatedAt: Date;
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

export default function EditorClient({ id, initialTitle, initialTemplate, initialContent, initialIsPublic, initialSlug, initialUpdatedAt }: Props) {
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
  const [lastSavedAt, setLastSavedAt] = useState<Date>(initialUpdatedAt);
  const [now, setNow] = useState(() => new Date());
  const [isExportingImage, setIsExportingImage] = useState(false);
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
    setTemplateState(next);
    await setTemplate(id, next);
  }

  async function onToggleShare() {
    const next = !isPublic;
    const { slug } = await toggleShare(id, next);
    setIsPublic(next);
    setPublicSlug(slug);
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
      {/* Toolbar — always visible on both layouts */}
      <div className="sticky top-14 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5">
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
          <div data-testid="editor-toolbar" className="ml-auto flex flex-wrap items-center gap-2">
            <StyleEditor templateId={template} onTemplateChange={changeTemplate} />
            <Separator orientation="vertical" className="h-6" />
            <ModuleManager sectionOrder={sectionOrder} onOrderChange={handleOrderChange} />
            <Separator orientation="vertical" className="h-6" />
            <Button size="sm" variant="outline" onClick={onToggleShare} className="gap-1.5">
              <Share2 className="h-3.5 w-3.5" />
              {isPublic ? "关闭分享" : "开启分享"}
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
            <Button
              size="sm"
              variant="outline"
              onClick={onExportImage}
              disabled={isExportingImage}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {isExportingImage ? "导出中" : "导出图片"}
            </Button>
            <a
              href={`/api/pdf/${id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/30"
            >
              <Download className="h-3.5 w-3.5" />下载 PDF
            </a>
          </div>
        </div>
      </div>

      {isDesktop ? (
        <div className="grid h-[calc(100vh-3.5rem-4rem)] grid-cols-2">
          <div className="space-y-6 overflow-y-auto border-r p-6">
            <BasicsEditor />
            {sectionOrder.filter(k => k !== "basics").map((key) => (
              <SectionWrapper key={key} id={key}>
                {key === "experience" && <ExperienceEditor />}
                {key === "education" && <EducationEditor />}
                {key === "projects" && <ProjectsEditor />}
                {key === "skills" && <SkillsEditor />}
                {isCustomSection(key) && <CustomSectionEditor sectionId={key} />}
              </SectionWrapper>
            ))}
          </div>
          <div className="overflow-y-auto bg-muted p-6">
            <LivePreview ref={previewRootRef} templateId={template} />
          </div>
        </div>
      ) : (
        <div>
          <Tabs defaultValue="edit" className="w-full">
            <TabsList className="sticky top-[calc(3.5rem+3.5rem)] z-20 grid w-full grid-cols-2 rounded-none border-b">
              <TabsTrigger value="edit">编辑</TabsTrigger>
              <TabsTrigger value="preview">预览</TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="space-y-6 p-4">
              <BasicsEditor />
              {sectionOrder.filter(k => k !== "basics").map((key) => (
                <SectionWrapper key={key} id={key}>
                  {key === "experience" && <ExperienceEditor />}
                  {key === "education" && <EducationEditor />}
                  {key === "projects" && <ProjectsEditor />}
                  {key === "skills" && <SkillsEditor />}
                  {isCustomSection(key) && <CustomSectionEditor sectionId={key} />}
                </SectionWrapper>
              ))}
            </TabsContent>
            <TabsContent value="preview" className="bg-muted p-4">
              <LivePreview ref={previewRootRef} templateId={template} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </FormProvider>
  );
}
