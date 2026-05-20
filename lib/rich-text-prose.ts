/** Shared typography for TipTap editor + resume preview (lists, paragraphs). */
const BASE_PROSE =
  "prose prose-sm max-w-none " +
  "prose-p:my-0.5 prose-p:leading-relaxed " +
  "[&_ul]:my-0.5 [&_ol]:my-0.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-4 [&_ol]:pl-4 " +
  "[&_li]:my-0 [&_li]:leading-snug [&_li_p]:my-0 [&_li>p]:leading-snug " +
  "[&_li+li]:mt-0";

export const RICH_TEXT_PROSE_CLASS = `${BASE_PROSE} text-neutral-800`;

export const RICH_TEXT_EDITOR_PROSE_CLASS = `${BASE_PROSE} text-foreground dark:prose-invert`;

export const DEFAULT_RICH_TEXT_FONT_SIZE = "14px";

export const RICH_TEXT_FONT_SIZES = [
  "12px",
  "13px",
  "14px",
  "16px",
  "18px",
] as const;
