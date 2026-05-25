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
      itemHeaderVariant: template.layout.itemHeaderVariant,
      sectionIcons: template.layout.sectionIcons,
    },
  );

  // Theme variables injected onto the article for descendants to consume via var(--primary), etc.
  const themeStyle: React.CSSProperties = {
    ["--primary" as string]: template.layout.theme.primaryColor,
    ...(template.layout.theme.accentColor && {
      ["--accent" as string]: template.layout.theme.accentColor,
    }),
  };

  const frame = template.layout.frame;
  const header = (
    <ResumeHeader
      basics={content.basics}
      variant={template.layout.headerVariant}
      showEmptyPlaceholders={showEmptyPlaceholders}
    />
  );

  if (frame.kind === "vertical") {
    return (
      <ResumePage
        styleSettings={styleSettings}
        decoration={template.decoration ?? undefined}
        style={themeStyle}
        maxWidthClass="max-w-[800px]"
        dataFrame="vertical"
        templateFontFamily={template.layout.theme.fontFamily}
      >
        {header}
        {order.map((key) => sections[key] ?? null)}
      </ResumePage>
    );
  }

  // Horizontal: split sectionOrder into sidebar / main, preserving order
  // within each. Sidebar holds the sections explicitly listed in
  // frame.sidebar.sections; everything else flows in main.
  const sidebarSet = new Set(frame.sidebar.sections);
  const sidebarOrder = order.filter((k) => sidebarSet.has(k));
  const mainOrder = order.filter((k) => !sidebarSet.has(k));

  const sidebarStyle: React.CSSProperties = {
    width: frame.sidebar.width,
    ...(frame.sidebar.bgColor ? { backgroundColor: frame.sidebar.bgColor } : {}),
    ...(frame.sidebar.textColor ? { color: frame.sidebar.textColor } : {}),
  };

  const sidebarEl = (
    <aside
      data-frame-sidebar=""
      data-side={frame.sidebar.side}
      style={sidebarStyle}
      className="shrink-0"
    >
      {sidebarOrder.map((key) => sections[key] ?? null)}
    </aside>
  );

  const mainEl = (
    <div className="min-w-0 flex-1">
      {mainOrder.map((key) => sections[key] ?? null)}
    </div>
  );

  return (
    <ResumePage
      styleSettings={styleSettings}
      decoration={template.decoration ?? undefined}
      style={themeStyle}
      maxWidthClass="max-w-[800px]"
      dataFrame="horizontal"
      templateFontFamily={template.layout.theme.fontFamily}
    >
      {header}
      <div className="flex gap-6">
        {frame.sidebar.side === "left" ? (
          <>
            {sidebarEl}
            {mainEl}
          </>
        ) : (
          <>
            {mainEl}
            {sidebarEl}
          </>
        )}
      </div>
    </ResumePage>
  );
}
