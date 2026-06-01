import { generateHTML } from "@tiptap/html";
import { tiptapExtensions } from "@/lib/tiptap-extensions";
import type { TipTapJSON } from "@/lib/tiptap-types";
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

export function RichTextRenderer({ content, className }: { content: TipTapJSON; className?: string }) {
  if (!content || !content.content || content.content.length === 0) return null;
  const rawHtml = generateHTML(content, tiptapExtensions);
  const html = normalizeInlineFontSizes(rawHtml);
  return (
    <div
      className={className ?? "prose prose-sm max-w-none resume-prose"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
