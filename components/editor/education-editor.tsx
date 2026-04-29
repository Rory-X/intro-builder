"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "./rich-text-editor";
import { emptyDoc } from "@/lib/tiptap-types";
import type { ResumeContent } from "@/lib/resume-schema";

export function EducationEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "education" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        教育背景
        <Button type="button" size="sm" onClick={() => append({ school: "", degree: "", major: "", start: "", end: "", gpa: "", highlights: emptyDoc() })}>
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
              <Label>亮点</Label>
              <RichTextEditor
                content={watch(`education.${idx}.highlights` as const)}
                onChange={(json) => setValue(`education.${idx}.highlights` as const, json, { shouldDirty: true })}
                placeholder="描述你的教育亮点…"
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
