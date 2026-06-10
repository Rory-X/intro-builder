import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { migrateContent } from "@/lib/migrate-content";
import { TemplateRender } from "@/lib/templates/render-server";
import { getTemplateMetaAsync } from "@/lib/templates/registry-server";
import { toSerializable } from "@/lib/templates/render";
import { PdfPreview } from "@/components/preview/pdf-preview";
import { verifyPdfToken } from "@/lib/pdf-token";
import { withDbRetry } from "@/lib/db-retry";

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ _pdf?: string; _token?: string; _breaks?: string }>;
}) {
  const { id } = await params;
  const { _pdf, _token, _breaks } = await searchParams;

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

  const row = await withDbRetry("preview.load", () =>
    db.query.resumes.findFirst({
      where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
    }),
  );
  if (!row) notFound();
  const content = migrateContent(row.content);
  const isPdf = _pdf === "1";

  if (isPdf) {
    const resolved = await getTemplateMetaAsync(row.templateId);
    return (
      <PdfPreview
        resolved={toSerializable(resolved)}
        content={content}
        styleSettings={content.styleSettings}
        initialPagination={parsePaginationData(_breaks)}
      />
    );
  }

  // Normal preview (non-PDF)
  return (
    <div className="bg-slate-100 py-8">
      <TemplateRender
        id={row.templateId}
        content={content}
        sectionOrder={content.sectionOrder}
        styleSettings={content.styleSettings}
      />
    </div>
  );
}

function parsePaginationData(value: string | undefined): { pageBreaks: number[]; totalHeight: number } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { pageBreaks?: unknown }).pageBreaks) &&
      typeof (parsed as { totalHeight?: unknown }).totalHeight === "number"
    ) {
      const pageBreaks = (parsed as { pageBreaks: unknown[] }).pageBreaks
        .filter((item): item is number => typeof item === "number" && Number.isFinite(item));
      const totalHeight = (parsed as { totalHeight: number }).totalHeight;
      if (totalHeight > 0) return { pageBreaks, totalHeight };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
