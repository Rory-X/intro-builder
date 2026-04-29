import type { ResumeContent } from "@/lib/resume-schema";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";

export function PreviewPanel({ content, templateId }: { content: ResumeContent; templateId: "classic" | "modern" }) {
  const Layout = templateId === "modern" ? ModernLayout : ClassicLayout;
  return (
    <div className="mx-auto w-full max-w-[820px]">
      <Layout content={content} sectionOrder={content.sectionOrder} styleSettings={content.styleSettings} />
    </div>
  );
}
