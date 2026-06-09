import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { migrateContent } from "@/lib/migrate-content";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { withDbRetry } from "@/lib/db-retry";
import EditorClient from "./editor-client";
import {
  getTemplateMetaAsync,
  listAllTemplatesAsync,
} from "@/lib/templates/registry-server";
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { getFavoriteTemplateIds } from "@/app/(app)/templates/actions";
import { toSerializable } from "@/lib/templates/render";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "编辑简历" };

export default async function EditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const userId = await requireUserId();
  const row = await withDbRetry("EditPage.resumeLookup", () =>
    db.query.resumes.findFirst({
      where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
    }),
  );
  if (!row) notFound();
  // Pre-resolve the current template + the merged template gallery + the
  // full set of uploaded templates so the client editor can dispatch
  // UploadedLayout vs built-in without making a round trip on every
  // templateId change. Bundle size scales with uploaded-template count
  // (Option C from the foundation plan); revisit if that count grows past
  // a few hundred.
  const [initialResolved, allTemplates, dbUploadedTemplates, favoritedTemplateIds] = await Promise.all([
    getTemplateMetaAsync(row.templateId),
    listAllTemplatesAsync(),
    listUploadedTemplates(),
    getFavoriteTemplateIds(userId),
  ]);
  return (
    <EditorClient
      id={row.id}
      initialTitle={row.title}
      initialTemplate={initialResolved.id}
      initialContent={migrateContent(row.content)}
      initialIsPublic={row.isPublic}
      initialSlug={row.slug ?? null}
      initialUpdatedAtIso={row.updatedAt.toISOString()}
      initialNowIso={new Date().toISOString()}
      initialResolvedTemplate={toSerializable(initialResolved)}
      uploadedTemplates={dbUploadedTemplates}
      allTemplates={allTemplates}
      favoritedTemplateIds={favoritedTemplateIds}
      from={from ?? null}
    />
  );
}
