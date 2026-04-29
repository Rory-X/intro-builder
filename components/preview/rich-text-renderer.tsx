import { generateHTML } from "@tiptap/html";
import { tiptapExtensions } from "@/lib/tiptap-extensions";
import type { TipTapJSON } from "@/lib/tiptap-types";

export function RichTextRenderer({ content, className }: { content: TipTapJSON; className?: string }) {
  if (!content || !content.content || content.content.length === 0) return null;
  const html = generateHTML(content, tiptapExtensions);
  return (
    <div
      className={className ?? "prose prose-sm max-w-none"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
