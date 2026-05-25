import { db } from "@/db";
import { templates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { DecorationConfig, LayoutConfig, UploadedTemplate } from "./types";

export async function fetchUploadedTemplate(id: string): Promise<UploadedTemplate | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.status, "published")))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToTemplate(rows[0]);
}

export async function listUploadedTemplates(): Promise<UploadedTemplate[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.status, "published"))
    .orderBy(templates.createdAt);
  return rows.map(rowToTemplate);
}

/**
 * Trust boundary: writes go through the template-studio skill (or seed
 * scripts) which validate against the LayoutConfig / DecorationConfig
 * shape before INSERT. We treat reads as already-validated and skip
 * Zod here to avoid duplicating schema definitions. If a corrupt row
 * sneaks in, downstream rendering will fail — which is the correct
 * signal: fix the writer, not the reader.
 */
function rowToTemplate(row: typeof templates.$inferSelect): UploadedTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    thumbnailUrl: row.thumbnailUrl,
    decoration: (row.decoration as DecorationConfig | null) ?? null,
    layout: row.layout as LayoutConfig,
  };
}
