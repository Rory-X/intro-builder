import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import { buildResumeSections, getSectionOrder } from "@/lib/templates/shared/render-sections";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";

export function ClassicLayout({
  content,
  sectionOrder,
  styleSettings,
  showEmptyPlaceholders,
}: TemplateLayoutProps) {
  const order = getSectionOrder(content, sectionOrder);
  const sections = buildResumeSections(content, "classic", { showEmptyPlaceholders });
  const ss = { ...DEFAULT_STYLE_SETTINGS, ...styleSettings };

  return (
    <ResumePage styleSettings={styleSettings} maxWidthClass="max-w-[800px]">
      <ResumeHeader basics={content.basics} variant="classic" photoScale={ss.photoScale} />
      {order.map((key) => sections[key] ?? null)}
    </ResumePage>
  );
}
