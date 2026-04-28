"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function EducationEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "education" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        教育背景
        <Button type="button" size="sm" onClick={() => append({ school: "", degree: "", major: "", start: "", end: "", gpa: "", highlights: [] })}>
          + 新增
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>学校</Label><Input {...register(`education.${idx}.school` as const)} /></div>
              <div><Label>学历</Label><Input {...register(`education.${idx}.degree` as const)} /></div>
              <div><Label>专业</Label><Input {...register(`education.${idx}.major` as const)} /></div>
              <div><Label>GPA</Label><Input {...register(`education.${idx}.gpa` as const)} /></div>
              <div><Label>开始</Label><Input {...register(`education.${idx}.start` as const)} /></div>
              <div><Label>结束</Label><Input {...register(`education.${idx}.end` as const)} /></div>
            </div>
            <div>
              <Label>亮点 (每行一条)</Label>
              <Textarea
                rows={3}
                value={((watch(`education.${idx}.highlights` as const) as string[]) ?? []).join("\n")}
                onChange={(e) => setValue(`education.${idx}.highlights` as const, e.target.value.split("\n").filter(Boolean), { shouldDirty: true })}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
