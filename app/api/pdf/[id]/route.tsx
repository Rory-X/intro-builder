import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { renderToStream } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";
import { ClassicPdf } from "@/lib/templates/classic/Pdf";
import { ModernPdf } from "@/lib/templates/modern/Pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("unauthorized", { status: 401 });
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, session.user.id)),
  });
  if (!row) return new NextResponse("not found", { status: 404 });
  const parsed = ResumeContent.safeParse(row.content);
  if (!parsed.success) return new NextResponse("invalid content", { status: 500 });
  const doc = row.templateId === "modern"
    ? <ModernPdf content={parsed.data} />
    : <ClassicPdf content={parsed.data} />;
  const stream = await renderToStream(doc);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(row.title)}.pdf"`,
    },
  });
}
