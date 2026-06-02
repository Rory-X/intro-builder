import { FONT_MAP } from "@/lib/font-map";
import type { StyleSettings } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import type { DecorationConfig } from "@/lib/templates/uploaded/types";
import { mergeStyleSettings } from "./merge-style-settings";

type Props = {
  styleSettings?: StyleSettings;
  className?: string;
  maxWidthClass?: string;
  decoration?: DecorationConfig;
  /** Extra CSS to merge into the article (e.g. theme CSS variables). Structural styles win. */
  style?: React.CSSProperties;
  /** Frame kind for skeleton-aware rendering. Surfaced on the article as data-frame
   *  so tests / dev tools can introspect; consumers may also key visual rules off it. */
  dataFrame?: string;
  /**
   * 模板级 fontFamily 覆盖（来自 `LayoutConfig.theme.fontFamily`）。设了
   * 优先于 styleSettings.fontFamily（用户级）；必须是 FONT_MAP 的 key
   * (`sans` / `serif` / `mono`)，否则被忽略走用户级（优雅降级，避免坏字符串
   * 击穿渲染）。built-in 模板不传该 prop 行为完全不变。
   */
  templateFontFamily?: string;
  children: React.ReactNode;
};

export function ResumePage({
  styleSettings,
  className,
  maxWidthClass = "max-w-[800px]",
  decoration,
  style,
  dataFrame,
  templateFontFamily,
  children,
}: Props) {
  const ss = mergeStyleSettings(styleSettings);

  // 模板级 fontFamily 优先（仅当是合法 FONT_MAP key 时）；否则保留用户级
  const fontKey =
    templateFontFamily && templateFontFamily in FONT_MAP
      ? (templateFontFamily as keyof typeof FONT_MAP)
      : ss.fontFamily;

  // Custom style first, structural styles last so structural wins
  const articleStyle: React.CSSProperties = {
    ...style,
    fontSize: `${ss.fontSize}px`,
    lineHeight: ss.bodyLineHeight,
    paddingTop: "40px",
    paddingBottom: "40px",
    paddingLeft: `${ss.pagePadding}px`,
    paddingRight: `${ss.pagePadding}px`,
    fontFamily: FONT_MAP[fontKey].css,
    backgroundColor: decoration?.pageBgColor ?? "#ffffff",
    color: "#000000",
    // CSS 变量给 ResumeSection 和 v2 customCss 消费 —— smart-layout 算法
    // 通过 setProperty 临时改这两个变量来测量压缩后高度。
    ["--section-gap" as string]: `${ss.sectionGap}px`,
    ["--item-gap" as string]: `${ss.itemGap}px`,
    // Heading-to-content gap is consumed by the inline <style> below as
    // margin-bottom on h1..h4. body-line-height is the inline `lineHeight`
    // applied above; this var exposes it to v2 customCss as well.
    ["--heading-gap" as string]: `${ss.headingGap}px`,
    ["--body-line-height" as string]: String(ss.bodyLineHeight),
  };

  const hasDecorationImage = Boolean(decoration?.bgImageUrl);

  // Inline scoped rule for heading-to-content gap. Lives here (not
  // globals.css) because Tailwind v4's CSS pipeline drops scoped rules on
  // build, and templates (especially v2 uploads) ship their own
  // `h2 { margin: 0 }` declarations that outrank low-specificity globals.
  // !important is the cheapest way to guarantee the user's排版 control wins.
  const headingGapStyle = `[data-resume-page] h1, [data-resume-page] h2, [data-resume-page] h3, [data-resume-page] h4 { margin-bottom: var(--heading-gap) !important; }`;

  return (
    <article
      className={cn("relative mx-auto", maxWidthClass, className)}
      style={articleStyle}
      data-frame={dataFrame}
      data-resume-page=""
    >
      <style dangerouslySetInnerHTML={{ __html: headingGapStyle }} />
      {hasDecorationImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-template-decoration
          src={decoration!.bgImageUrl}
          alt=""
          aria-hidden
          className="pointer-events-none"
          style={{
            position: decoration!.placement.position,
            top: decoration!.placement.top,
            right: decoration!.placement.right,
            width: decoration!.placement.width,
            height: decoration!.placement.height,
            zIndex: decoration!.placement.zIndex,
            opacity: decoration!.placement.opacity,
          }}
        />
      )}
      {/*
        Wrap children in an extra positioning div ONLY when a decoration image
        is rendered — otherwise this wrapper would break templates that rely
        on the article being the direct grid/flex container of their children
        (e.g. modern's `grid-cols-[240px_1fr]` aside + main layout).
      */}
      {hasDecorationImage ? (
        <div className="relative" style={{ zIndex: 1 }}>
          {children}
        </div>
      ) : (
        children
      )}
    </article>
  );
}
