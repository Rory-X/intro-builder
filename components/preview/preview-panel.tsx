import type { ResumeContent } from "@/lib/resume-schema";
export function PreviewPanel({ content, templateId }: { content: ResumeContent; templateId: string }) {
  return (
    <div className="mx-auto w-full max-w-[800px] rounded bg-white p-8 shadow">
      <div className="mb-4 text-xs text-muted-foreground">template: {templateId}</div>
      <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(content, null, 2)}</pre>
    </div>
  );
}
