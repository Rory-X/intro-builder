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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const values = form.watch();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(async () => {
        try {
          await saveResume(id, values, title);
        } catch (e: any) {
          toast.error("保存失败：" + e.message);
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

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="space-y-6 overflow-y-auto border-r p-6">
        <div className="flex items-center gap-3">
          <Input
            value={title}
            onChange={(e) => setTitleState(e.target.value)}
            className="max-w-xs text-base"
          />
          <span className="text-xs text-muted-foreground">{isPending ? "保存中…" : "已保存"}</span>
          <div className="ml-auto flex gap-2">
            <Button
              variant={template === "classic" ? "default" : "outline"}
              size="sm"
              onClick={() => changeTemplate("classic")}
            >经典</Button>
            <Button
              variant={template === "modern" ? "default" : "outline"}
              size="sm"
              onClick={() => changeTemplate("modern")}
            >现代</Button>
            <Button size="sm" variant="outline" onClick={onToggleShare}>
              {isPublic ? "关闭分享" : "开启分享"}
            </Button>
            {isPublic && publicSlug && (
              <a
                className="self-center text-xs text-muted-foreground underline"
                href={`/r/${publicSlug}`}
                target="_blank"
                rel="noreferrer"
              >
                /r/{publicSlug}
              </a>
            )}
            <a
              href={`/api/pdf/${id}`}
              className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
            >下载 PDF</a>
          </div>
        </div>
        <FormProvider {...form}>
          <BasicsEditor />
          <ExperienceEditor />
          <EducationEditor />
          <ProjectsEditor />
          <SkillsEditor />
        </FormProvider>
      </div>
      <div className="overflow-y-auto bg-slate-100 p-6">
        <PreviewPanel content={values as ResumeContent} templateId={template} />
      </div>
    </div>
  );
}
