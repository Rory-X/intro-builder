"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ResumeContent } from "@/lib/resume-schema";

export function BasicsEditor() {
  const { register, formState } = useFormContext<ResumeContent>();
  const err = formState.errors.basics;
  const F = ({ k, label, type = "text" }: { k: keyof ResumeContent["basics"]; label: string; type?: string }) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input type={type} {...register(`basics.${k}` as const)} />
      {err?.[k]?.message && <p className="text-xs text-red-500">{String(err[k]?.message)}</p>}
    </div>
  );
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 text-lg font-semibold">基础信息</h2>
      <div className="grid grid-cols-2 gap-3">
        <F k="name" label="姓名" />
        <F k="title" label="目标岗位" />
        <F k="email" label="邮箱" type="email" />
        <F k="phone" label="电话" />
        <F k="location" label="城市" />
        <F k="website" label="个人主页 (可选)" />
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <Label>自我介绍</Label>
        <Textarea rows={4} {...register("basics.summary")} />
      </div>
    </section>
  );
}
