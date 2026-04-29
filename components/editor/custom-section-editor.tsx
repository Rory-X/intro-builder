"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@/lib/resume-schema";
import { getSectionMeta } from "@/lib/section-meta";
import { SectionEditorHeader } from "./section-editor-header";
import { useState } from "react";

type Props = {
  sectionId: string;
};

export function CustomSectionEditor({ sectionId }: Props) {
  const { watch, setValue, getValues } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);

  const custom = watch("custom") ?? [];
  const idx = custom.findIndex((c) => c.id === sectionId);
  if (idx === -1) return null;

  const section = custom[idx];
  const meta = getSectionMeta(sectionId);

  return (
    <section>
      <div className="px-4 pt-2">
        <SectionEditorHeader
          sectionKey={sectionId}
          itemCount={0}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => {}} // No items to add for custom sections
          addLabel=""
        />
      </div>
      {isOpen && (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <Label>模块标题</Label>
            <Input
              value={section.title}
              onChange={(e) => {
                const updated = [...getValues("custom")];
                updated[idx] = { ...updated[idx], title: e.target.value };
                setValue("custom", updated, { shouldDirty: true });
              }}
              placeholder="输入模块标题…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>内容</Label>
            <RichTextEditor
              content={section.content}
              onChange={(json) => {
                const updated = [...getValues("custom")];
                updated[idx] = { ...updated[idx], content: json };
                setValue("custom", updated, { shouldDirty: true });
              }}
              placeholder="输入模块内容…"
            />
          </div>
        </div>
      )}
    </section>
  );
}
