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
import { SectionEditorHeader } from "./section-editor-header";

export function EducationEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "education" });
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        if (source.data.type === "item" && target.data.type === "item" && source.data.sectionKey === "education") {
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
          sectionKey="education"
          itemCount={fields.length}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => { append({ school: "", degree: "", major: "", location: "", start: "", end: "", gpa: "", highlights: emptyDoc() }); setIsOpen(true); }}
        />
      </div>
      {isOpen && (
        <div className="space-y-2.5 px-4 pb-4">
          {fields.map((f, idx) => {
            const school = watch(`education.${idx}.school` as const);
            const sub = [watch(`education.${idx}.degree` as const), watch(`education.${idx}.major` as const)].filter(Boolean).join(" · ");
            return (
            <ItemWrapper
              key={f.id}
              id={f.id}
              sectionKey="education"
              collapsible
              onDelete={() => remove(idx)}
              summary={<ItemSummary title={school} parts={[sub]} />}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-2 gap-y-[5px]">
                  <div data-testid="education-school-field" className="col-span-2 flex flex-col gap-1.5"><Label>学校</Label><Input {...register(`education.${idx}.school` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>学历</Label><Input {...register(`education.${idx}.degree` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>专业</Label><Input {...register(`education.${idx}.major` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>城市</Label><Input {...register(`education.${idx}.location` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>GPA</Label><Input {...register(`education.${idx}.gpa` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>开始</Label><Input {...register(`education.${idx}.start` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>结束</Label><Input {...register(`education.${idx}.end` as const)} /></div>
                </div>
                <div>
                  <Label>在校经历/奖项</Label>
                  <RichTextEditor
                    key={`education-highlights-${f.id}`}
                    content={watch(`education.${idx}.highlights` as const)}
                    onChange={(json) => setValue(`education.${idx}.highlights` as const, json, { shouldDirty: true })}
                    placeholder="描述你的在校经历、荣誉奖项或相关成果…"
                  />
                </div>
              </div>
            </ItemWrapper>
            );
          })}
        </div>
      )}
    </section>
  );
}
