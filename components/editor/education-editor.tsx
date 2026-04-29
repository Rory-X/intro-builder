"use client";
import { useEffect, useState } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "./rich-text-editor";
import { emptyDoc } from "@/lib/tiptap-types";
import type { ResumeContent } from "@/lib/resume-schema";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { ItemWrapper } from "./item-wrapper";
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
      <div className="px-4 pt-2">
        <SectionEditorHeader
          sectionKey="education"
          itemCount={fields.length}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => { append({ school: "", degree: "", major: "", start: "", end: "", gpa: "", highlights: emptyDoc() }); setIsOpen(true); }}
        />
      </div>
      {isOpen && (
        <div className="space-y-3 px-4 pb-4">
          {fields.map((f, idx) => (
            <ItemWrapper key={f.id} id={f.id} sectionKey="education">
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5"><Label>学校</Label><Input {...register(`education.${idx}.school` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>学历</Label><Input {...register(`education.${idx}.degree` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>专业</Label><Input {...register(`education.${idx}.major` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>GPA</Label><Input {...register(`education.${idx}.gpa` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>开始</Label><Input {...register(`education.${idx}.start` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>结束</Label><Input {...register(`education.${idx}.end` as const)} /></div>
                </div>
                <div>
                  <Label>亮点</Label>
                  <RichTextEditor
                    content={watch(`education.${idx}.highlights` as const)}
                    onChange={(json) => setValue(`education.${idx}.highlights` as const, json, { shouldDirty: true })}
                    placeholder="描述你的教育亮点…"
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => remove(idx)}>删除此条</Button>
              </div>
            </ItemWrapper>
          ))}
        </div>
      )}
    </section>
  );
}
