"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "./rich-text-editor";
import { emptyDoc } from "@/lib/tiptap-types";
import type { ResumeContent } from "@/lib/resume-schema";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableItem } from "./item-sortable";

export function ExperienceEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "experience" });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = fields.findIndex(f => f.id === active.id);
    const newIdx = fields.findIndex(f => f.id === over.id);
    move(oldIdx, newIdx);
  }

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        工作经历
        <Button type="button" size="sm" onClick={() => append({ company: "", title: "", start: "", end: "", location: "", content: emptyDoc() })}>
          + 新增
        </Button>
      </h2>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {fields.map((f, idx) => (
              <SortableItem key={f.id} id={f.id}>
                <div className="space-y-2 rounded border p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>公司</Label><Input {...register(`experience.${idx}.company` as const)} /></div>
                    <div><Label>职位</Label><Input {...register(`experience.${idx}.title` as const)} /></div>
                    <div><Label>开始</Label><Input placeholder="2023.07" {...register(`experience.${idx}.start` as const)} /></div>
                    <div><Label>结束</Label><Input placeholder="至今" {...register(`experience.${idx}.end` as const)} /></div>
                  </div>
                  <div>
                    <Label>工作成果</Label>
                    <RichTextEditor
                      content={watch(`experience.${idx}.content` as const)}
                      onChange={(json) => setValue(`experience.${idx}.content` as const, json, { shouldDirty: true })}
                      placeholder="描述你的工作成果…"
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
                </div>
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
