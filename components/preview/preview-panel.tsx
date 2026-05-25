import { forwardRef } from "react";
import type { ResumeContent } from "@/lib/resume-schema";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import { PaginatedPreview } from "./paginated-preview";

type Props = {
  content: ResumeContent;
  resolvedTemplate: SerializableResolvedTemplate;
};

export const PreviewPanel = forwardRef<HTMLDivElement, Props>(function PreviewPanel({
  content,
  resolvedTemplate,
}, ref) {
  return (
    <div className="flex justify-center">
      <PaginatedPreview
        ref={ref}
        content={content}
        resolvedTemplate={resolvedTemplate}
        styleSettings={content.styleSettings}
        showEmptyPlaceholders
      />
    </div>
  );
});
