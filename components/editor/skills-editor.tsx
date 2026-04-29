"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableItem } from "./item-sortable";

export function SkillsEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "skills" });
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
        技能
        <Button type="button" size="sm" onClick={() => append({ category: "", items: [] })}>
          + 新增分组
        </Button>
      </h2>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {fields.map((f, idx) => (
              <SortableItem key={f.id} id={f.id}>
                <div className="space-y-2 rounded border p-3">
                  <div><Label>分类名 (如：语言 / 框架)</Label><Input {...register(`skills.${idx}.category` as const)} /></div>
                  <div>
                    <Label>项目列表 (逗号分隔)</Label>
                    <Input
                      value={((watch(`skills.${idx}.items` as const) as string[]) ?? []).join(", ")}
                      onChange={(e) => setValue(`skills.${idx}.items` as const, e.target.value.split(",").map(s => s.trim()).filter(Boolean), { shouldDirty: true })}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此组</Button>
                </div>
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
