import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import {
  buildResumeSections,
  getSectionOrder,
} from "@/lib/templates/shared/render-sections";
import type { UploadedTemplate } from "./types";

type Props = TemplateLayoutProps & {
  template: UploadedTemplate;
};

export function UploadedLayout({
  content,
  sectionOrder,
  styleSettings,
  showEmptyPlaceholders,
  template,
}: Props) {
  const order = getSectionOrder(content, sectionOrder);
  const sections = buildResumeSections(
    content,
    template.layout.sectionTitleVariant,
    {
      includeBasicsSummary: true,
      showEmptyPlaceholders,
    },
  );

  // Theme variables injected onto the article for descendants to consume via var(--primary), etc.
  const themeStyle: React.CSSProperties = {
    ["--primary" as string]: template.layout.theme.primaryColor,
    ...(template.layout.theme.accentColor && {
      ["--accent" as string]: template.layout.theme.accentColor,
    }),
  };

  return (
    <ResumePage
      styleSettings={styleSettings}
      decoration={template.decoration ?? undefined}
      style={themeStyle}
      maxWidthClass="max-w-[800px]"
    >
      <ResumeHeader
        basics={content.basics}
        variant={template.layout.headerVariant}
        showEmptyPlaceholders={showEmptyPlaceholders}
      />
      {order.map((key) => sections[key] ?? null)}
    </ResumePage>
  );
}
