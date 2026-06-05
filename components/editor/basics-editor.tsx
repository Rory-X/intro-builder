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
    <section className="rounded-lg border bg-card p-2.5">
      <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-primary/10">
          <span className="text-[10px] font-bold text-primary">i</span>
        </div>
        基础信息
      </h2>
      <div className="flex items-start gap-2.5">
        <PhotoUpload />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
          <Input
            id="basics-name"
            {...register("basics.name")}
            placeholder="你的姓名"
            aria-label="姓名"
            className="h-auto rounded-none border-x-0 border-t-0 border-b border-transparent bg-transparent px-0 py-0.5 text-[15px] font-medium shadow-none focus-visible:border-b-border focus-visible:ring-0"
          />
          {err?.name?.message && (
            <p className="text-xs text-destructive">{String(err.name?.message)}</p>
          )}
          <span className="text-[10px] text-muted-foreground/60">点击左侧上传头像（可选，4MB 内）</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-[5px]">
        {FIELDS.map(({ k, label, type = "text", colSpan = 1 }) => (
          <div
            key={k}
            className={cn("flex flex-col gap-0.5", colSpan === 2 && "col-span-2")}
          >
            <Label htmlFor={`basics-${k}`}>{label}</Label>
            <Input id={`basics-${k}`} type={type} {...register(`basics.${k}` as const)} />
            {err?.[k]?.message && (
              <p className="text-xs text-destructive">{String(err[k]?.message)}</p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        <Label htmlFor="basics-summary">自我介绍</Label>
        <Textarea id="basics-summary" rows={2} {...register("basics.summary")} className="resize-vertical" />
      </div>
    </section>
  );
}
