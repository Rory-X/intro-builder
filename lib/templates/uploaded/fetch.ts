import { db } from "@/db";
import { templates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { DecorationConfig, LayoutConfig, UploadedTemplate } from "./types";

/**
 * Defensive: if the DB doesn't have the `templates` table yet (migration
 * hasn't run, or we're booting against a partially-provisioned env), we
 * silently return an empty result instead of crashing the dashboard /
 * editor. Other operational errors still warn but don't bubble up — the
 * app keeps working with built-in templates only. Run the migration to
 * unlock uploaded templates.
 */
function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /relation .*templates.* does not exist|no such table/i.test(msg);
}

export async function fetchUploadedTemplate(id: string): Promise<UploadedTemplate | null> {
  try {
    const rows = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.status, "published")))
      .limit(1);
    if (rows.length === 0) return null;
    return rowToTemplate(rows[0]);
  } catch (err) {
    if (isMissingTableError(err)) return null;
    console.warn("[templates] fetchUploadedTemplate failed:", err);
    return null;
  }
}

export async function listUploadedTemplates(): Promise<UploadedTemplate[]> {
  try {
    const rows = await db
      .select()
      .from(templates)
      .where(eq(templates.status, "published"))
      .orderBy(templates.createdAt);
    return rows.map(rowToTemplate);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    console.warn("[templates] listUploadedTemplates failed:", err);
    return [];
  }
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
