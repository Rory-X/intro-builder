"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@/lib/resume-schema";
import { SectionEditorHeader } from "./section-editor-header";
import { cn } from "@/lib/utils";

export function SkillsEditor() {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);

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
        />
      </div>
      <div className={cn(
        "grid transition-all duration-300 ease-out",
        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}>
        <div className="overflow-hidden">
          <div className="px-3.5 pb-3.5">
            <RichTextEditor
              key="skills-richtext"
              content={watch("skills")}
              onChange={(json) => setValue("skills", json, { shouldDirty: true })}
              placeholder="如：编程语言：JavaScript、TypeScript、Python&#10;框架：React、Next.js、Vue&#10;工具：Git、Docker、Linux"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
