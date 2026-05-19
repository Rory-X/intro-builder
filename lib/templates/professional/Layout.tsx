import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import { buildResumeSections, getSectionOrder } from "@/lib/templates/shared/render-sections";

export function ProfessionalLayout({ content, sectionOrder, styleSettings }: TemplateLayoutProps) {
  const order = getSectionOrder(content, sectionOrder);
  const sections = buildResumeSections(content, "professional", {
    includeBasicsSummary: false,
  });

  return (
    <ResumePage styleSettings={styleSettings} maxWidthClass="max-w-[800px]">
      <ResumeHeader basics={content.basics} variant="professional" />
      {order.map((key) => sections[key] ?? null)}
    </ResumePage>
  );
}
