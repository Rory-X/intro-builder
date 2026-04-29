"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ResumeContent } from "@/lib/resume-schema";
import { PhotoUpload } from "./photo-upload";

type BasicsKey = keyof ResumeContent["basics"];

const FIELDS: Array<{ k: BasicsKey; label: string; type?: string }> = [
  { k: "name", label: "姓名" },
  { k: "title", label: "目标岗位" },
  { k: "email", label: "邮箱", type: "email" },
  { k: "phone", label: "电话" },
  { k: "location", label: "城市" },
  { k: "website", label: "个人主页 (可选)" },
];

export function BasicsEditor() {
  const { register, formState } = useFormContext<ResumeContent>();
  const err = formState.errors.basics;
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-lg font-semibold">基础信息</h2>
      <PhotoUpload />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {FIELDS.map(({ k, label, type = "text" }) => (
          <div key={k} className="flex flex-col gap-1">
            <Label htmlFor={`basics-${k}`}>{label}</Label>
            <Input id={`basics-${k}`} type={type} {...register(`basics.${k}` as const)} />
            {err?.[k]?.message && (
              <p className="text-xs text-red-500">{String(err[k]?.message)}</p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <Label htmlFor="basics-summary">自我介绍</Label>
        <Textarea id="basics-summary" rows={4} {...register("basics.summary")} />
      </div>
    </section>
  );
}
