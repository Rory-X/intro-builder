import { forwardRef } from "react";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import { PaginatedPreview } from "./paginated-preview";

type Props = {
  content: ResumeContent;
  resolvedTemplate: SerializableResolvedTemplate;
  onPaginationChange?: (data: { pageBreaks: number[]; totalHeight: number }) => void;
};

export const PreviewPanel = forwardRef<HTMLDivElement, Props>(function PreviewPanel({
  content,
  resolvedTemplate,
  onPaginationChange,
}, ref) {
  return (
    <div className="flex justify-center">
      <PaginatedPreview
        ref={ref}
        content={content}
        resolvedTemplate={resolvedTemplate}
        styleSettings={content.styleSettings}
        showEmptyPlaceholders
        onPaginationChange={onPaginationChange}
      />
    </div>
  );
});
