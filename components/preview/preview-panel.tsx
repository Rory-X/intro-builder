import { forwardRef } from "react";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { PaginatedPreview } from "./paginated-preview";

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
      <PaginatedPreview
        ref={ref}
        content={content}
        templateId={templateId}
        styleSettings={content.styleSettings}
        showEmptyPlaceholders
      />
    </div>
  );
});
