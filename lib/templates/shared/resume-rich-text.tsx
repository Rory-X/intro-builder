import { RichTextRenderer } from "@/components/preview/rich-text-renderer";
import { RICH_TEXT_PROSE_CLASS } from "@/lib/rich-text-prose";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { cn } from "@/lib/utils";

/** @deprecated Use RICH_TEXT_PROSE_CLASS */
export const RESUME_PROSE_CLASS = RICH_TEXT_PROSE_CLASS;

export function ResumeRichText({
  content,
  className,
}: {
  content: TipTapJSON;
  className?: string;
}) {
  return <RichTextRenderer content={content} className={cn(RESUME_PROSE_CLASS, className)} />;
}
