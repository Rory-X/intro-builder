"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { SectionEditorHeader } from "./section-editor-header";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHelperButton } from "@/components/agent/section-helper-button";
import { tiptapPlainText } from "@/lib/agent/resume-helper-context";
import { useCompletenessScore } from "@/hooks/use-completeness-score";

type Props = {
  sectionId: string;
  resumeId?: string;
};

export function CustomSectionEditor({ sectionId, resumeId }: Props) {
  const { watch, setValue, getValues } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);
  const completeness = useCompletenessScore();

  const custom = watch("custom") ?? [];
  const idx = custom.findIndex((c) => c.id === sectionId);
  if (idx === -1) return null;

  const section = custom[idx];

  return (
    <section>
      <div>
        <SectionEditorHeader
          sectionKey={sectionId}
          itemCount={0}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => {}} // No items to add for custom sections
          addLabel=""
          helper={resumeId ? (
            <SectionHelperButton
              resumeId={resumeId}
              section="custom"
              fieldPath={`custom.${idx}.content`}
              label={section.title || "自定义模块"}
              plainText={tiptapPlainText(section.content)}
              completeness={completeness}
            />
          ) : undefined}
        />
      </div>
      <div className={cn(
        "grid transition-all duration-300 ease-out",
        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )} data-section-body-collapsed={isOpen ? undefined : "true"}>
        <div className="overflow-hidden">
        <div className="space-y-2.5 px-3.5 pb-3.5">
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
              key={`custom-content-${sectionId}`}
              content={section.content}
              onChange={(json) => {
                const updated = [...getValues("custom")];
                updated[idx] = { ...updated[idx], content: json };
                setValue("custom", updated, { shouldDirty: true });
              }}
              polish={resumeId ? {
                resumeId,
                section: "custom",
                fieldPath: `custom.${idx}.content`,
              } : undefined}
              placeholder="输入模块内容…"
            />
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
