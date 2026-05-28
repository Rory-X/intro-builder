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
    lineHeight: ss.lineHeight,
    padding: `${ss.pagePadding}px`,
    fontFamily: FONT_MAP[fontKey].css,
    backgroundColor: decoration?.pageBgColor ?? "#ffffff",
    color: "#000000",
  };

  const hasDecorationImage = Boolean(decoration?.bgImageUrl);

  return (
    <article
      className={cn("relative mx-auto", maxWidthClass, className)}
      style={articleStyle}
      data-frame={dataFrame}
    >
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
