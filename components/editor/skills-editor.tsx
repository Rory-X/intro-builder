"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function SkillsEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "skills" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        技能
        <Button type="button" size="sm" onClick={() => append({ category: "", items: [] })}>
          + 新增分组
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
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
        ))}
      </div>
    </section>
  );
}
