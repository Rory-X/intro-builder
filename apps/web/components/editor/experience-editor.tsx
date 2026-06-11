"use client";
import { useEffect, useState } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "./rich-text-editor";
import { emptyDoc } from "@/lib/tiptap-types";
import type { ResumeContent } from "@/lib/resume-schema";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { ItemWrapper, ItemSummary } from "./item-wrapper";
import { cn } from "@/lib/utils";
import { SectionEditorHeader } from "./section-editor-header";
import { SectionHelperButton } from "@/components/agent/section-helper-button";
import { tiptapPlainText } from "@/lib/agent/resume-helper-context";
import { useCompletenessScore } from "@/hooks/use-completeness-score";

type Props = {
  resumeId?: string;
};

export function ExperienceEditor({ resumeId }: Props) {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "experience" });
  const [isOpen, setIsOpen] = useState(true);
  const completeness = useCompletenessScore();
  const experience = watch("experience") ?? [];
  const helperText = experience.map((item) => tiptapPlainText(item.content)).filter(Boolean).join("\n");

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        if (source.data.type === "item" && target.data.type === "item" && source.data.sectionKey === "experience") {
          const fromId = source.data.id as string;
          const toId = target.data.id as string;
          const oldIdx = fields.findIndex(f => f.id === fromId);
          const newIdx = fields.findIndex(f => f.id === toId);
          if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
            move(oldIdx, newIdx);
          }
        }
      },
    });
  }, [fields, move]);

  return (
    <section>
      <div>
        <SectionEditorHeader
          sectionKey="experience"
          itemCount={fields.length}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => { append({ company: "", title: "", start: "", end: "", location: "", content: emptyDoc() }); setIsOpen(true); }}
          helper={resumeId ? (
            <SectionHelperButton
              resumeId={resumeId}
              section="experience"
              fieldPath="experience"
              label="工作经历"
              plainText={helperText}
              completeness={completeness}
            />
          ) : undefined}
        />
      </div>
      <div className={cn(
        "grid transition-all duration-300 ease-out",
        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )} data-section-body-collapsed={isOpen ? undefined : "true"}>
        <div className="overflow-hidden">
        <div className="space-y-4 px-3.5 pb-3.5">
          {fields.map((f, idx) => {
            const company = watch(`experience.${idx}.company` as const);
            const position = watch(`experience.${idx}.title` as const);
            const range = [watch(`experience.${idx}.start` as const), watch(`experience.${idx}.end` as const)].filter(Boolean).join(" – ");
            return (
            <ItemWrapper
              key={f.id}
              id={f.id}
              sectionKey="experience"
              collapsible
              onDelete={() => remove(idx)}
              summary={<ItemSummary title={company} parts={[position, range]} />}
            >
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-x-2 gap-y-[5px]">
                  <div className="col-span-2 flex flex-col gap-1.5"><Label>公司</Label><Input {...register(`experience.${idx}.company` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>职位</Label><Input {...register(`experience.${idx}.title` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>城市</Label><Input {...register(`experience.${idx}.location` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>开始</Label><Input placeholder="2023.07" {...register(`experience.${idx}.start` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>结束</Label><Input placeholder="至今" {...register(`experience.${idx}.end` as const)} /></div>
                </div>
                <div>
                  <Label>工作成果</Label>
                  <RichTextEditor
                    key={`experience-content-${f.id}`}
                    content={watch(`experience.${idx}.content` as const)}
                    onChange={(json) => setValue(`experience.${idx}.content` as const, json, { shouldDirty: true })}
                    polish={resumeId ? {
                      resumeId,
                      section: "experience",
                      fieldPath: `experience.${idx}.content`,
                    } : undefined}
                    placeholder="描述你的工作成果…"
                  />
                </div>
              </div>
            </ItemWrapper>
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}
