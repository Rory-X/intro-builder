"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function ProjectsEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "projects" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        项目经历
        <Button type="button" size="sm" onClick={() => append({ name: "", stack: [], link: "", bullets: [] })}>
          + 新增
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
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
              <Label>项目亮点 (每行一条)</Label>
              <Textarea
                rows={3}
                value={((watch(`projects.${idx}.bullets` as const) as string[]) ?? []).join("\n")}
                onChange={(e) => setValue(`projects.${idx}.bullets` as const, e.target.value.split("\n").filter(Boolean), { shouldDirty: true })}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
