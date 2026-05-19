import { RichTextRenderer } from "@/components/preview/rich-text-renderer";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { cn } from "@/lib/utils";

export const RESUME_PROSE_CLASS =
  "prose prose-sm max-w-none text-neutral-800 prose-p:my-1 prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1";

export function ResumeRichText({
  content,
  className,
}: {
  content: TipTapJSON;
  className?: string;
}) {
  return <RichTextRenderer content={content} className={cn(RESUME_PROSE_CLASS, className)} />;
}
