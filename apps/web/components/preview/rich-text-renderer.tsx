import { generateHTML } from "@tiptap/html";
import { tiptapExtensions } from "@/lib/tiptap-extensions";
import type { TipTapJSON } from "@intro-builder/shared/types";
import { RICH_TEXT_BASE_PX } from "@/lib/rich-text-prose";

/**
 * Post-process generated HTML to ensure all inline font-size values are
 * relative (em), so they scale with the parent's font-size (set by ResumePage).
 *
 * This handles:
 * - Legacy content stored as absolute px (e.g., "14px")
 * - TipTap generateHTML output that may produce px values
 *
 * Converts: "font-size: 14px" → "font-size: 1.08em" (14/13)
 * Leaves em values unchanged.
 */
function normalizeInlineFontSizes(html: string): string {
  return html.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (_, px) => {
    const num = parseFloat(px);
    // If it's the base size, just remove it (inherit from parent)
    if (Math.abs(num - RICH_TEXT_BASE_PX) < 0.5) {
      return "font-size: 1em";
    }
    const em = (num / RICH_TEXT_BASE_PX).toFixed(2);
    return `font-size: ${em}em`;
  });
}

function toHexColor(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function normalizeInlineColors(html: string): string {
  return html.replace(
    /color:\s*rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi,
    (_, r, g, b) =>
      `color: #${toHexColor(Number(r))}${toHexColor(Number(g))}${toHexColor(Number(b))}`,
  );
}

export function normalizeRichTextHtml(html: string): string {
  return normalizeInlineColors(normalizeInlineFontSizes(html));
}

export function RichTextRenderer({ content, className }: { content: TipTapJSON; className?: string }) {
  if (!content || !content.content || content.content.length === 0) return null;
  const rawHtml = generateHTML(content, tiptapExtensions);
  const html = normalizeRichTextHtml(rawHtml);
  return (
    <div
      className={className ?? "prose prose-sm max-w-none"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
