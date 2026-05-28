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
import { DENSITY_PRESETS } from "@/lib/style-presets";
import type { StyleSettings } from "@/lib/resume-schema";

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

/**
 * Uploaded 模板还没把 defaultStyleSettings / category / tags 写进 DB jsonb。
 * 在 registry 边界给一个稳定的回退：standard 密度预设。Skill 后续如果产出
 * 这些字段，可以走 jsonb 扩展从 layout / decoration 解析进来，但现在保持
 * schema 不动让客户端代码可以无差别消费 builtin 与 uploaded。
 */
const UPLOADED_DEFAULT_STYLE_SETTINGS: StyleSettings = {
  ...DENSITY_PRESETS.standard.settings,
};

export async function listAllTemplatesAsync(): Promise<AllTemplatesItem[]> {
  const builtin: AllTemplatesItem[] = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    thumbnailUrl: null,
    source: "builtin",
    isRecommended: t.isRecommended,
    defaultStyleSettings: t.defaultStyleSettings,
    category: t.category,
    features: t.features,
    tags: t.tags,
  }));
  const uploaded = await listUploadedTemplates();
  const uploadedItems: AllTemplatesItem[] = uploaded.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    thumbnailUrl: t.thumbnailUrl,
    source: "uploaded",
    defaultStyleSettings: UPLOADED_DEFAULT_STYLE_SETTINGS,
    category: t.category ?? undefined,
    features: t.features ?? undefined,
    tags: undefined,
  }));
  return [...builtin, ...uploadedItems];
}

/**
 * 给 setTemplate 用：拿到任意 templateId 对应的"应用此模板时该用的 styleSettings"。
 * builtin → meta.defaultStyleSettings；uploaded → 标准回退。Skill 之后如果给
 * uploaded 加了字段，只需改这里一个分支。
 */
export function getTemplateDefaultStyleSettings(
  resolved: ResolvedTemplateMeta,
): StyleSettings {
  if (resolved.source === "builtin") {
    return resolved.meta.defaultStyleSettings;
  }
  return UPLOADED_DEFAULT_STYLE_SETTINGS;
}

export type { ResolvedTemplateMeta };
