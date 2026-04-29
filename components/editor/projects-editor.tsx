"use client";
import { useEffect } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "./rich-text-editor";
import { emptyDoc } from "@/lib/tiptap-types";
import type { ResumeContent } from "@/lib/resume-schema";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { ItemWrapper } from "./item-wrapper";

export function ProjectsEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "projects" });

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        if (source.data.type === "item" && target.data.type === "item" && source.data.sectionKey === "projects") {
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
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        项目经历
        <Button type="button" size="sm" onClick={() => append({ name: "", stack: [], link: "", content: emptyDoc() })}>
          + 新增
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <ItemWrapper key={f.id} id={f.id} sectionKey="projects">
            <div className="space-y-2 rounded border p-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>项目名</Label><Input {...register(`projects.${idx}.name` as const)} /></div>
                <div><Label>链接</Label><Input {...register(`projects.${idx}.link` as const)} /></div>
              </div>
              <div>
                <Label>技术栈 (逗号分隔)</Label>
                <Input
                  value={((watch(`projects.${idx}.stack` as const) as string[]) ?? []).join(", ")}
                  onChange={(e) => setValue(`projects.${idx}.stack` as const, e.target.value.split(",").map(s => s.trim()).filter(Boolean), { shouldDirty: true })}
                />
              </div>
              <div>
                <Label>项目亮点</Label>
                <RichTextEditor
                  content={watch(`projects.${idx}.content` as const)}
                  onChange={(json) => setValue(`projects.${idx}.content` as const, json, { shouldDirty: true })}
                  placeholder="描述你的项目亮点…"
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
            </div>
          </ItemWrapper>
        ))}
      </div>
    </section>
  );
}
