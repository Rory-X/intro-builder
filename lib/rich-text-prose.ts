/** Shared typography for TipTap editor + resume preview (lists, paragraphs). */
const BASE_PROSE =
  "prose prose-sm max-w-none text-[1em] " +
  "prose-p:my-0.5 prose-p:leading-relaxed " +
  "[&_ul]:my-0.5 [&_ol]:my-0.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-4 [&_ol]:pl-4 " +
  "[&_li]:my-0 [&_li]:leading-snug [&_li_p]:my-0 [&_li>p]:leading-snug " +
  "[&_li+li]:mt-0";

export const RICH_TEXT_PROSE_CLASS = `${BASE_PROSE} text-neutral-800`;

export const RICH_TEXT_EDITOR_PROSE_CLASS = `${BASE_PROSE} text-foreground dark:prose-invert`;

/**
 * Default font size as relative em (1em = inherits from ResumePage's fontSize).
 * When text is at default size, no textStyle mark is stored.
 */
export const DEFAULT_RICH_TEXT_FONT_SIZE = "1em";

/**
 * Base font size (px) used to calculate em values.
 * This is the DEFAULT_STYLE_SETTINGS.fontSize from resume-schema.
 */
export const RICH_TEXT_BASE_PX = 13;

/**
 * Available font sizes stored as em values.
 * UI displays the equivalent px number (based on base=13px) for user clarity.
 */
export const RICH_TEXT_FONT_SIZES = [
  "0.92em",  // ~12px
  "1em",     // 13px (default)
  "1.08em",  // ~14px
  "1.23em",  // ~16px
  "1.38em",  // ~18px
] as const;

/**
 * Map from em value → display label (px number shown to user).
 */
export const RICH_TEXT_FONT_SIZE_LABELS: Record<string, string> = {
  "0.92em": "12",
  "1em": "13",
  "1.08em": "14",
  "1.23em": "16",
  "1.38em": "18",
};
