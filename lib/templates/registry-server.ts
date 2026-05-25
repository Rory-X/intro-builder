import {
  BUILTIN_TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
  type BuiltinTemplateId,
} from "./types";
import {
  TEMPLATES,
  type AllTemplatesItem,
  type ResolvedTemplateMeta,
} from "./registry";
import { fetchUploadedTemplate, listUploadedTemplates } from "./uploaded/fetch";

/**
 * Server-only template lookups. Lives in a separate file because it pulls
 * in the DB module graph (postgres / fs / net) — importing it from a
 * client component would crash the bundle. Use `lib/templates/registry.ts`
 * for the client-safe surface (TEMPLATES, resolveTemplateId, types).
 *
 * Convention enforced by code review only — there is no `server-only`
 * runtime guard installed in this project. If you find yourself wanting
 * to import from this file in a client component, you actually want one
 * of: the synchronous `getTemplateMeta` from `./registry`, or a server
 * action that calls into here on your behalf.
 */

function isBuiltinId(id: string): id is BuiltinTemplateId {
  return (BUILTIN_TEMPLATE_IDS as readonly string[]).includes(id);
}

/**
 * Resolution semantics:
 * - id is null/undefined/empty       → fallback to default built-in (no DB call)
 * - id is a built-in id              → return built-in meta (no DB call)
 * - id is non-empty, unknown, DB hit → return uploaded template
 * - id is non-empty, unknown, DB miss → fallback to default built-in
 * - DB throws (network/schema error) → propagate (callers handle)
 *
 * Fallback hides "not found" but NOT operational errors. If you need to
 * distinguish "missing" from "broken DB", catch in the caller.
 */
export async function getTemplateMetaAsync(
  id: string | null | undefined,
): Promise<ResolvedTemplateMeta> {
  // Built-in fast path — no DB call
  if (id && isBuiltinId(id)) {
    const meta = TEMPLATES.find((t) => t.id === id)!;
    return { source: "builtin", id, meta };
  }
  // DB lookup for non-empty unknown ids
  if (id) {
    const dbTemplate = await fetchUploadedTemplate(id);
    if (dbTemplate) {
      return { source: "uploaded", id: dbTemplate.id, template: dbTemplate };
    }
  }
  // Fallback to default built-in (DB miss or empty id)
  const fallback = TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
  return { source: "builtin", id: DEFAULT_TEMPLATE_ID, meta: fallback };
}

export type { AllTemplatesItem };

export async function listAllTemplatesAsync(): Promise<AllTemplatesItem[]> {
  const builtin: AllTemplatesItem[] = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    thumbnailUrl: null,
    source: "builtin",
    isRecommended: t.isRecommended,
  }));
  const uploaded = await listUploadedTemplates();
  const uploadedItems: AllTemplatesItem[] = uploaded.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    thumbnailUrl: t.thumbnailUrl,
    source: "uploaded",
  }));
  return [...builtin, ...uploadedItems];
}

export type { ResolvedTemplateMeta };
