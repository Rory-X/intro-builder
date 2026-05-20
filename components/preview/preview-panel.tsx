import { forwardRef } from "react";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { TemplateRenderer } from "./template-renderer";

type Props = {
  content: ResumeContent;
  templateId: TemplateId | string;
};

export const PreviewPanel = forwardRef<HTMLDivElement, Props>(function PreviewPanel({
  content,
  templateId,
}, ref) {
  return (
    <div className="flex justify-center">
      <div
        ref={ref}
        data-testid="resume-export-preview"
        className="w-full max-w-[840px] rounded-sm bg-white shadow-md ring-1 ring-black/5"
      >
        <TemplateRenderer
          templateId={templateId}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={content.styleSettings}
          showEmptyPlaceholders
        />
      </div>
    </div>
  );
});
