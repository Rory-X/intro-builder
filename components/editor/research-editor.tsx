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

export function ResearchEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "research" });
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        if (source.data.type === "item" && target.data.type === "item" && source.data.sectionKey === "research") {
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
          sectionKey="research"
          itemCount={fields.length}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => { append({ name: "", role: "", start: "", end: "", link: "", content: emptyDoc() }); setIsOpen(true); }}
        />
      </div>
      {isOpen && (
        <div className="space-y-3 px-4 pb-4">
          {fields.map((f, idx) => (
            <ItemWrapper key={f.id} id={f.id} sectionKey="research">
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5"><Label>课题名</Label><Input {...register(`research.${idx}.name` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>角色</Label><Input placeholder="研究助理、第一作者…" {...register(`research.${idx}.role` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>开始</Label><Input placeholder="2025-03" {...register(`research.${idx}.start` as const)} /></div>
                  <div className="flex flex-col gap-1.5"><Label>结束</Label><Input placeholder="2025-06" {...register(`research.${idx}.end` as const)} /></div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>论文链接</Label>
                  <Input placeholder="DOI 或论文 URL（选填）" {...register(`research.${idx}.link` as const)} />
                </div>
                <div>
                  <Label>研究描述</Label>
                  <RichTextEditor
                    key={`research-content-${f.id}`}
                    content={watch(`research.${idx}.content` as const)}
                    onChange={(json) => setValue(`research.${idx}.content` as const, json, { shouldDirty: true })}
                    placeholder="描述你的研究内容和成果…"
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
