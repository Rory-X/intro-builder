"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@/lib/resume-schema";
import { SectionEditorHeader } from "./section-editor-header";
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
      <div className="px-4 pt-2">
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
      {isOpen && (
        <div className="px-4 pb-4">
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
      )}
    </section>
  );
}
