import {
  fetchDefaultUploadedTemplate,
  fetchUploadedTemplate,
  listUploadedTemplates,
} from "./uploaded/fetch";
import { DENSITY_PRESETS } from "@/lib/style-presets";
import type { StyleSettings } from "@intro-builder/shared/schemas";
import type {
  AllTemplatesItem,
  ResolvedTemplateMeta,
} from "./registry";
import type { UploadedTemplate } from "./uploaded/types";

/**
 * Server-only template lookups.
 *
 * All templates are DB rows. There is intentionally no built-in/local-file
 * branch here: unknown ids and empty ids resolve to the single published row
 * marked `isDefault=true`.
 */

export type { AllTemplatesItem };

const UPLOADED_DEFAULT_STYLE_SETTINGS: StyleSettings = {
  ...DENSITY_PRESETS.standard.settings,
};

function templateStyleSettings(template: UploadedTemplate): StyleSettings {
  const dbSettings = (template as { defaultStyleSettings?: StyleSettings }).defaultStyleSettings;
  return dbSettings ?? UPLOADED_DEFAULT_STYLE_SETTINGS;
}

async function getDefaultTemplate(): Promise<UploadedTemplate> {
  const template = await fetchDefaultUploadedTemplate();
  if (!template) {
    throw new Error(
      "[registry-server] No published template row has isDefault=true. " +
      "Seed the templates table before deploying DB-only template resolution.",
    );
  }
  return template;
}

export async function getDefaultTemplateId(): Promise<string> {
  const template = await getDefaultTemplate();
  return template.id;
}

export async function getTemplateMetaAsync(
  id: string | null | undefined,
): Promise<ResolvedTemplateMeta> {
  const normalized = id?.trim();
  if (normalized) {
    const template = await fetchUploadedTemplate(normalized);
    if (template) {
      return { source: "uploaded", id: template.id, template };
    }
  }

  const fallback = await getDefaultTemplate();
  return { source: "uploaded", id: fallback.id, template: fallback };
}

export async function listAllTemplatesAsync(): Promise<AllTemplatesItem[]> {
  const dbTemplates = await listUploadedTemplates();

  return dbTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    thumbnailUrl: template.thumbnailUrl,
    source: "uploaded" as const,
    defaultStyleSettings: templateStyleSettings(template),
    category: template.category ?? undefined,
    features: template.features ?? undefined,
    tags: undefined,
  }));
}

export function getTemplateDefaultStyleSettings(
  resolved: ResolvedTemplateMeta,
): StyleSettings {
  return templateStyleSettings(resolved.template);
}

export type { ResolvedTemplateMeta };
