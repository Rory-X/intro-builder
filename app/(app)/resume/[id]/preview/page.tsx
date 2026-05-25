import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { migrateContent } from "@/lib/migrate-content";
import { TemplateRenderer } from "@/components/preview/template-renderer";
import { verifyPdfToken } from "@/lib/pdf-token";

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ _pdf?: string; _token?: string }>;
}) {
  const { id } = await params;
  const { _pdf, _token } = await searchParams;

  // When accessed by the remote PDF service with a signed token, skip session auth
  let userId: string;
  if (_pdf === "1" && _token) {
    const result = verifyPdfToken(_token, id);
    if (!result.valid || !result.userId) {
      notFound();
    }
    userId = result.userId;
  } else {
    userId = await requireUserId();
  }

  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
  });
  if (!row) notFound();
  const content = migrateContent(row.content);
  const isPdf = _pdf === "1";

  return (
    <>
      {isPdf && (
        <style dangerouslySetInnerHTML={{ __html: `
          @page { size: A4; margin: 40px 0; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
          header, nav, footer { display: none !important; }
          [data-pagination-header] { display: block !important; }
          article { padding-top: 0 !important; padding-bottom: 0 !important; }
          [data-pagination-section] { break-inside: avoid; }
          [data-pagination-item] { break-inside: avoid; }
        `}} />
      )}
      <div className={isPdf ? "" : "bg-slate-100 py-8"}>
        <TemplateRenderer
          templateId={row.templateId}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={content.styleSettings}
        />
      </div>
    </>
  );
}
