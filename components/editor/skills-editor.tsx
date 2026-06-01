"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@/lib/resume-schema";
import { SectionEditorHeader } from "./section-editor-header";

export function SkillsEditor() {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);

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
        />
      </div>
      {isOpen && (
        <div className="px-4 pb-4">
          <RichTextEditor
            key="skills-richtext"
            content={watch("skills")}
            onChange={(json) => setValue("skills", json, { shouldDirty: true })}
            placeholder="如：编程语言：JavaScript、TypeScript、Python&#10;框架：React、Next.js、Vue&#10;工具：Git、Docker、Linux"
          />
        </div>
      )}
    </section>
  );
}
