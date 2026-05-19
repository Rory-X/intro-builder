import type { ResumeContent } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { TemplateRenderer } from "./template-renderer";

export function PreviewPanel({
  content,
  templateId,
}: {
  content: ResumeContent;
  templateId: TemplateId | string;
}) {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[840px] rounded-sm bg-white shadow-md ring-1 ring-black/5">
        <TemplateRenderer
          templateId={templateId}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={content.styleSettings}
        />
      </div>
    </div>
  );
}
