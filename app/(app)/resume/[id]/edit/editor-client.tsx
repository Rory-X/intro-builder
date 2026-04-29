"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ResumeContent } from "@/lib/resume-schema";
import { saveResume, setTemplate, toggleShare } from "./actions";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { BasicsEditor } from "@/components/editor/basics-editor";
import { ExperienceEditor } from "@/components/editor/experience-editor";
import { EducationEditor } from "@/components/editor/education-editor";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { SkillsEditor } from "@/components/editor/skills-editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Download, Share2, LayoutTemplate } from "lucide-react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { SectionWrapper } from "@/components/editor/section-wrapper";
import { ModuleManager } from "@/components/editor/module-manager";
import { CustomSectionEditor } from "@/components/editor/custom-section-editor";
import { StyleEditor } from "@/components/editor/style-editor";
import { arrayMove } from "@/lib/array-move";
import { DEFAULT_SECTION_ORDER, BUILTIN_SECTION_KEYS } from "@/lib/resume-schema";

type Props = {
  id: string;
  initialTitle: string;
  initialTemplate: "classic" | "modern";
  initialContent: ResumeContent;
  initialIsPublic: boolean;
  initialSlug: string | null;
};

export default function EditorClient({ id, initialTitle, initialTemplate, initialContent, initialIsPublic, initialSlug }: Props) {
  const form = useForm({
    resolver: zodResolver(ResumeContent),
    defaultValues: initialContent,
    mode: "onChange",
  });
  const [title, setTitleState] = useState(initialTitle);
  const [template, setTemplateState] = useState<"classic" | "modern">(initialTemplate);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicSlug, setPublicSlug] = useState<string | null>(initialSlug);
  const [isPending, startTransition] = useTransition();
  const [sectionOrder, setSectionOrder] = useState<string[]>(
    initialContent.sectionOrder ?? [...DEFAULT_SECTION_ORDER]
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const values = form.watch();

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
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(async () => {
        try {
          await saveResume(id, values, title);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("保存失败：" + msg);
        }
      });
    }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), title]);

  async function changeTemplate(next: "classic" | "modern") {
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
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${isPending ? "bg-orange-500/10 text-orange-600 dark:text-orange-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isPending ? "bg-orange-500 animate-pulse" : "bg-emerald-500"}`} />
            {isPending ? "保存中" : "已保存"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
              <Button
                variant={template === "classic" ? "default" : "ghost"}
                size="sm"
                onClick={() => changeTemplate("classic")}
                className="gap-1.5"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />经典
              </Button>
              <Button
                variant={template === "modern" ? "default" : "ghost"}
                size="sm"
                onClick={() => changeTemplate("modern")}
                className="gap-1.5"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />现代
              </Button>
            </div>
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
            <a
              href={`/api/pdf/${id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/30"
            >
              <Download className="h-3.5 w-3.5" />下载 PDF
            </a>
          </div>
        </div>
      </div>

      {/* Desktop: side-by-side grid */}
      <div className="hidden lg:grid h-[calc(100vh-3.5rem-4rem)] grid-cols-2">
        <div className="space-y-6 overflow-y-auto border-r p-6">
          <StyleEditor />
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
          <PreviewPanel content={values as ResumeContent} templateId={template} />
        </div>
      </div>

      {/* Mobile: tabs */}
      <div className="lg:hidden">
        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="sticky top-[calc(3.5rem+3.5rem)] z-20 grid w-full grid-cols-2 rounded-none border-b">
            <TabsTrigger value="edit">编辑</TabsTrigger>
            <TabsTrigger value="preview">预览</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="space-y-6 p-4">
            <StyleEditor />
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
            <PreviewPanel content={values as ResumeContent} templateId={template} />
          </TabsContent>
        </Tabs>
      </div>
    </FormProvider>
  );
}
