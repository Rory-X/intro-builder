"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { SectionEditorHeader } from "./section-editor-header";
import { cn } from "@/lib/utils";
import { SectionHelperButton } from "@/components/agent/section-helper-button";
import { tiptapPlainText } from "@/lib/agent/resume-helper-context";
import { useCompletenessScore } from "@/hooks/use-completeness-score";

type Props = {
  resumeId?: string;
};

export function SkillsEditor({ resumeId }: Props) {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);
  const completeness = useCompletenessScore();
  const skills = watch("skills");
  const helperText = tiptapPlainText(skills);

  return (
    <section>
      <div>
        <SectionEditorHeader
          sectionKey="skills"
          itemCount={0}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onAdd={() => {}}
          addLabel=""
          helper={resumeId ? (
            <SectionHelperButton
              resumeId={resumeId}
              section="skills"
              fieldPath="skills"
              label="技能"
              plainText={helperText}
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
          <div className="px-3.5 pb-3.5">
            <RichTextEditor
              key="skills-richtext"
              content={watch("skills")}
              onChange={(json) => setValue("skills", json, { shouldDirty: true })}
              polish={resumeId ? {
                resumeId,
                section: "skills",
                fieldPath: "skills",
              } : undefined}
              placeholder="如：编程语言：JavaScript、TypeScript、Python&#10;框架：React、Next.js、Vue&#10;工具：Git、Docker、Linux"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
