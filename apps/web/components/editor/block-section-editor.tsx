"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { RichTextEditor } from "./rich-text-editor";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { SectionEditorHeader } from "./section-editor-header";
import { cn } from "@/lib/utils";

/**
 * 一等公民「富文本块」模块的通用编辑器，与 SkillsEditor 同型：固定标题（走
 * section-meta，不可改）、一个富文本框。用于个人总结 / 荣誉奖项 / 作品集
 * （field 即 section id，也是顶层 ResumeContent 字段名）。
 *
 * 区别于 CustomSectionEditor：后者面向用户自建模块，多一个可改的「模块标题」
 * 输入框、内容存在 custom[] 数组里。这三个是具名模块，标题固定、内容存顶层字段。
 */
type BlockField = "summary" | "awards" | "portfolio";

export function BlockSectionEditor({
  field,
  placeholder,
}: {
  field: BlockField;
  placeholder?: string;
}) {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section>
      <div>
        <SectionEditorHeader
          sectionKey={field}
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
              key={`${field}-richtext`}
              content={watch(field)}
              onChange={(json) => setValue(field, json, { shouldDirty: true })}
              placeholder={placeholder}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
