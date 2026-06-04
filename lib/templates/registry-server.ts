import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import type { UploadedTemplate } from "./uploaded/types";

import type { SectionIconDeclaration } from "./uploaded/types";

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

const UNIFIED_BUILTIN_IDS = ["classic", "modern", "professional"] as const satisfies readonly BuiltinTemplateId[];

function isUnifiedBuiltinId(id: string): id is (typeof UNIFIED_BUILTIN_IDS)[number] {
  return (UNIFIED_BUILTIN_IDS as readonly string[]).includes(id);
}

export function usesUnifiedBuiltinRenderer(id: string): boolean {
  return isUnifiedBuiltinId(id);
}

/**
 * Resolution semantics:
 * - id is null/undefined/empty       → fallback to default built-in (no DB call)
 * - id is a unified built-in id      → local HTML first, then DB, then built-in meta
 * - id is another built-in id        → return built-in meta (no DB call)
 * - id is non-empty, unknown, DB hit → return uploaded template
 * - id is non-empty, unknown, DB miss → fallback to default built-in
 * - DB throws (network/schema error) → propagate (callers handle)
 *
 * Fallback hides "not found" but NOT operational errors. If you need to
 * distinguish "missing" from "broken DB", catch in the caller.
 */
/**
 * Builtin 模板的本地 HTML+CSS fallback。当 DB 查询失败时，
 * 从本地文件读取，确保新渲染路径不因网络抖动回退到旧 React 组件。
 */
function getBuiltinHtmlFallback(id: string): { html: string; css: string } | null {
  try {
    const dir = join(process.cwd(), "templates", "html");
    const html = readFileSync(join(dir, `${id}.html`), "utf-8");
    const css = readFileSync(join(dir, `${id}.css`), "utf-8");
    return { html, css };
  } catch {
    return null;
  }
}

const BUILTIN_SECTION_ICONS: Record<string, Record<string, SectionIconDeclaration>> = {
  classic: {
    basics: { icon: "LayoutList", color: "#64748b" },
    experience: { icon: "Briefcase", color: "#3b82f6" },
    education: { icon: "GraduationCap", color: "#22c55e" },
    projects: { icon: "FolderGit2", color: "#a855f7" },
    skills: { icon: "Wrench", color: "#f97316" },
    research: { icon: "FlaskConical", color: "#14b8a6" },
    summary: { icon: "LayoutList", color: "#06b6d4" },
    awards: { icon: "Award", color: "#eab308" },
    portfolio: { icon: "Palette", color: "#ec4899" },
  },
  professional: {},
  modern: {},
};

function getBuiltinHtmlFallbackTemplate(id: BuiltinTemplateId): UploadedTemplate | null {
  if (!isUnifiedBuiltinId(id)) return null;
  const local = getBuiltinHtmlFallback(id);
  if (!local) return null;
  const meta = TEMPLATES.find((t) => t.id === id);
  if (!meta) return null;
  return {
    id,
    name: meta.name,
    description: meta.description,
    thumbnailUrl: null,
    layout: {
      frame: { kind: "vertical" },
      headerVariant: "professional",
      sectionTitleVariant: "professional",
      itemHeaderVariant: "professional",
      theme: { primaryColor: "#171717" },
      sectionIcons: BUILTIN_SECTION_ICONS[id] ?? {},
    },
    html: local.html,
    css: local.css,
    category: meta.category,
    features: meta.features,
  };
}

export function listBuiltinHtmlFallbackTemplates(): UploadedTemplate[] {
  return UNIFIED_BUILTIN_IDS.flatMap((id) => {
    const template = getBuiltinHtmlFallbackTemplate(id);
    return template ? [template] : [];
  });
}

export async function getTemplateMetaAsync(
  id: string | null | undefined,
): Promise<ResolvedTemplateMeta> {
  // Unified builtin: local HTML is the source of truth
  if (id && isUnifiedBuiltinId(id)) {
    const localTemplate = getBuiltinHtmlFallbackTemplate(id);
    if (localTemplate) {
      return { source: "uploaded", id, template: localTemplate };
    }
    throw new Error(
      `[registry-server] Builtin template "${id}" has no local HTML file ` +
      `(expected templates/html/${id}.html). Cannot render.`
    );
  }

  // Non-unified builtin (shouldn't exist after migration, but handle gracefully)
  if (id && isBuiltinId(id)) {
    const localTemplate = getBuiltinHtmlFallbackTemplate(id);
    if (localTemplate) {
      return { source: "uploaded", id, template: localTemplate };
    }
    throw new Error(
      `[registry-server] Builtin template "${id}" has no local HTML file. ` +
      `The v1 React rendering engine has been removed.`
    );
  }

  // 尝试从 DB 查
  if (id) {
    const dbTemplate = await fetchUploadedTemplate(id);
    if (dbTemplate) {
      return { source: "uploaded", id: dbTemplate.id, template: dbTemplate };
    }
  }

  // Fallback to default builtin
  const defaultTemplate = getBuiltinHtmlFallbackTemplate(DEFAULT_TEMPLATE_ID);
  if (defaultTemplate) {
    return { source: "uploaded", id: DEFAULT_TEMPLATE_ID, template: defaultTemplate };
  }
  throw new Error(
    `[registry-server] Default template "${DEFAULT_TEMPLATE_ID}" has no local HTML file. Build is broken.`
  );
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
  const dbTemplates = await listUploadedTemplates();

  if (dbTemplates.length > 0) {
    // DB available — build list from DB rows, enriching builtin rows with
    // code-only fields (defaultStyleSettings, isRecommended, tags).
    const builtinMetaMap = new Map(TEMPLATES.map((t) => [t.id, t]));
    const seenBuiltinIds = new Set<string>();

    const items: AllTemplatesItem[] = dbTemplates.map((t) => {
      const codeMeta = builtinMetaMap.get(t.id);
      if (codeMeta) {
        seenBuiltinIds.add(t.id);
        return {
          id: t.id,
          name: t.name,
          description: t.description ?? "",
          thumbnailUrl: t.thumbnailUrl,
          source: "builtin" as const,
          isRecommended: codeMeta.isRecommended,
          defaultStyleSettings: codeMeta.defaultStyleSettings,
          category: t.category ?? codeMeta.category,
          features: t.features ?? codeMeta.features,
          tags: codeMeta.tags,
        };
      }
      return {
        id: t.id,
        name: t.name,
        description: t.description ?? "",
        thumbnailUrl: t.thumbnailUrl,
        source: "uploaded" as const,
        defaultStyleSettings: UPLOADED_DEFAULT_STYLE_SETTINGS,
        category: t.category ?? undefined,
        features: t.features ?? undefined,
        tags: undefined,
      };
    });

    // Append any builtin templates not yet seeded into DB (fallback safety)
    for (const t of TEMPLATES) {
      if (!seenBuiltinIds.has(t.id)) {
        items.unshift({
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
        });
      }
    }

    // Stable ordering: builtin first (in TEMPLATES[] order), then uploaded (DB order)
    const builtinItems = items.filter((i) => i.source === "builtin");
    const uploadedItems = items.filter((i) => i.source === "uploaded");
    const builtinOrder = TEMPLATES.map((t) => t.id);
    builtinItems.sort(
      (a, b) => builtinOrder.indexOf(a.id) - builtinOrder.indexOf(b.id),
    );

    return [...builtinItems, ...uploadedItems];
  }

  // DB not available — fallback to code-only built-in list
  return TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    thumbnailUrl: null,
    source: "builtin" as const,
    isRecommended: t.isRecommended,
    defaultStyleSettings: t.defaultStyleSettings,
    category: t.category,
    features: t.features,
    tags: t.tags,
  }));
}

/**
 * 给 setTemplate 用：拿到任意 templateId 对应的"应用此模板时该用的 styleSettings"。
 * builtin → meta.defaultStyleSettings；uploaded → DB 列优先，无则标准回退。
 */
export function getTemplateDefaultStyleSettings(
  resolved: ResolvedTemplateMeta,
): StyleSettings {
  if (isBuiltinId(resolved.id)) {
    const meta = TEMPLATES.find((t) => t.id === resolved.id);
    if (meta) return meta.defaultStyleSettings;
  }
  const dbSettings = (resolved.template as { defaultStyleSettings?: StyleSettings }).defaultStyleSettings;
  if (dbSettings) return dbSettings;
  return UPLOADED_DEFAULT_STYLE_SETTINGS;
}

export type { ResolvedTemplateMeta };
