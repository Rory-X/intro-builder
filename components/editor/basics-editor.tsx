"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { PhotoScaleControl, PhotoUpload } from "./photo-upload";
import { SectionEditorHeader } from "./section-editor-header";

type BasicsKey = keyof ResumeContent["basics"];

const FIELDS: Array<{ k: BasicsKey; label: string; type?: string; colSpan?: 1 | 2 }> = [
  { k: "phone", label: "电话" },
  { k: "email", label: "邮箱", type: "email" },
  { k: "location", label: "城市" },
  { k: "status", label: "求职状态" },
  { k: "title", label: "求职方向" },
  { k: "website", label: "个人主页 / GitHub" },
];

export function BasicsEditor({ isActive }: { isActive?: boolean }) {
  const { register, formState } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);
  const err = formState.errors.basics;
  return (
    <section className={cn(
      "overflow-hidden rounded-xl border bg-card transition-all duration-200",
      isActive ? "border-primary/60" : "border-border/70 hover:border-primary/40",
    )}>
      <SectionEditorHeader
        sectionKey="basics"
        itemCount={1}
        isOpen={isOpen}
        onToggle={() => setIsOpen((open) => !open)}
        onAdd={() => {}}
        addLabel=""
      />
      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-300 px-3.5 pb-3.5">
          <div className="mb-4">
            <div className="flex items-start gap-4">
              <div className="flex w-[64px] shrink-0 flex-col items-center">
                <PhotoUpload showScaleControl={false} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 items-start">
                <Input
                  id="basics-name"
                  {...register("basics.name")}
                  placeholder="你的姓名"
                  aria-label="姓名"
                  className="h-auto rounded-md border border-transparent bg-transparent px-1.5 py-1.5 font-bold leading-none shadow-none hover:border-border focus-visible:border-border focus-visible:ring-0"
                  style={{ fontSize: "20px", height: "auto" }}
                />
                {err?.name?.message && (
                  <p className="text-xs text-destructive">{String(err.name?.message)}</p>
                )}
                <PhotoScaleControl />
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">点击上传头像（可选，4MB 以内）</p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-[11px]">
            {FIELDS.map(({ k, label, type = "text", colSpan = 1 }) => (
              <div
                key={k}
                className={cn("flex flex-col gap-1.5", colSpan === 2 && "col-span-2")}
              >
                <Label htmlFor={`basics-${k}`} className="text-[12px] text-muted-foreground">{label}</Label>
                <Input id={`basics-${k}`} type={type} {...register(`basics.${k}` as const)} className="h-[38px] rounded-md px-2.5 text-[13.5px]" />
                {err?.[k]?.message && (
                  <p className="text-xs text-destructive">{String(err[k]?.message)}</p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-[11px] flex flex-col gap-1.5">
            <Label htmlFor="basics-summary" className="text-[12px] text-muted-foreground">自我介绍</Label>
            <Textarea id="basics-summary" rows={2} {...register("basics.summary")} className="min-h-[60px] resize-vertical rounded-md px-2.5 py-2 text-[13.5px] leading-[1.55]" />
          </div>
        </div>
      )}
    </section>
  );
}
