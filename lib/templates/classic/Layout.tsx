import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import { buildResumeSections, getSectionOrder } from "@/lib/templates/shared/render-sections";

export function ClassicLayout({
  content,
  sectionOrder,
  styleSettings,
  showEmptyPlaceholders,
}: TemplateLayoutProps) {
  const order = getSectionOrder(content, sectionOrder);
  const sections = buildResumeSections(content, "classic", { showEmptyPlaceholders });

  return (
    <ResumePage styleSettings={styleSettings} maxWidthClass="max-w-[800px]">
      <ResumeHeader basics={content.basics} variant="classic" />
      {order.map((key) => sections[key] ?? null)}
    </ResumePage>
  );
}
