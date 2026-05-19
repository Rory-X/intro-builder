"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { PhotoUpload } from "./photo-upload";

type BasicsKey = keyof ResumeContent["basics"];

const FIELDS: Array<{ k: BasicsKey; label: string; type?: string; colSpan?: 1 | 2 }> = [
  { k: "name", label: "姓名", colSpan: 2 },
  { k: "phone", label: "电话" },
  { k: "email", label: "邮箱", type: "email" },
  { k: "website", label: "个人知识库 / 主页" },
  { k: "status", label: "状态（如：大三在读）" },
  { k: "location", label: "城市" },
  { k: "title", label: "求职方向（如：web前端）" },
];

export function BasicsEditor() {
  const { register, formState } = useFormContext<ResumeContent>();
  const err = formState.errors.basics;
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2.5 text-lg font-semibold">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <span className="text-xs font-bold text-primary">i</span>
        </div>
        基础信息
      </h2>
      <PhotoUpload />
      <div className="mt-5 grid grid-cols-2 gap-4">
        {FIELDS.map(({ k, label, type = "text", colSpan = 1 }) => (
          <div
            key={k}
            className={cn("flex flex-col gap-1.5", colSpan === 2 && "col-span-2")}
          >
            <Label htmlFor={`basics-${k}`}>{label}</Label>
            <Input id={`basics-${k}`} type={type} {...register(`basics.${k}` as const)} />
            {err?.[k]?.message && (
              <p className="text-xs text-destructive">{String(err[k]?.message)}</p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        <Label htmlFor="basics-summary">自我介绍</Label>
        <Textarea id="basics-summary" rows={4} {...register("basics.summary")} className="resize-none" />
      </div>
    </section>
  );
}
