import type { ResumeContent } from "@/lib/resume-schema";
import { ClassicLayout } from "@/lib/templates/classic/Layout";

export function PreviewPanel({ content, templateId }: { content: ResumeContent; templateId: "classic" | "modern" }) {
  // Modern added in Task 15
  void templateId;
  return (
    <div className="mx-auto w-full max-w-[820px]">
      <ClassicLayout content={content} />
    </div>
  );
}
