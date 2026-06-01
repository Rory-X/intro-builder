import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import {
  buildResumeSections,
  getSectionOrder,
} from "@/lib/templates/shared/render-sections";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";
import { SlotRenderer } from "./html-slot-renderer";
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
  // Skill v2 自由排版路径：customHtml 非空时走 SlotRenderer。完全旁路 v1
  // 的 ResumeHeader / ResumePage / buildResumeSections —— 视觉骨架由
  // Claude 写的 HTML 决定。layout JSON 字段在 v2 路径中**忽略不用**（仅
  // 作为兜底 schema）。见 spec §4.4。
  if (template.customHtml) {
    return (
      <SlotRenderer
        html={template.customHtml}
        css={template.customCss}
        content={content}
        styleSettings={styleSettings ?? DEFAULT_STYLE_SETTINGS}
        templateId={template.id}
      />
    );
  }

  // v1 enum 路径（abbey / abbey-stub 等）—— 不变
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
      ["--resume-accent" as string]: template.layout.theme.accentColor,
    }),
    // Card-wrapped variant 用的 3 个 CSS 变量（仅当 Skill 设了对应字段时注入；
    // 未设时 ResumeSection 的 card-wrapped 分支走 inline fallback 默认值）
    ...(template.layout.theme.cardBg && {
      ["--card-bg" as string]: template.layout.theme.cardBg,
    }),
    ...(template.layout.theme.cardRadius && {
      ["--card-radius" as string]: template.layout.theme.cardRadius,
    }),
    ...(template.layout.theme.cardShadow && {
      ["--card-shadow" as string]: template.layout.theme.cardShadow,
    }),
  };

  const frame = template.layout.frame;
  // theme.hideHeader=true 时整个 ResumeHeader 不渲染 — 用于 banner-PNG 自带姓名/头像/联系方式的模板
  const header = template.layout.theme.hideHeader ? null : (
    <ResumeHeader
      basics={content.basics}
      variant={template.layout.headerVariant}
      showEmptyPlaceholders={showEmptyPlaceholders}
    />
  );

  if (frame.kind === "vertical") {
    // hideHeader 模式下，banner-PNG 作为 decoration absolute 占顶部 ~280px。
    // sections 默认会从 article padding-top 开始覆盖在 banner 上 — 用 spacer 把
    // 它们推到 banner 下方。
    const bannerSpacer =
      template.layout.theme.hideHeader && template.decoration?.bgImageUrl ? (
        <div style={{ height: "280px", flexShrink: 0 }} aria-hidden />
      ) : null;
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
        {bannerSpacer}
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
