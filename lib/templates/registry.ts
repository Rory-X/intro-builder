import { ClassicLayout } from "./classic/Layout";
import { classicMeta } from "./classic/meta";
import { ModernLayout } from "./modern/Layout";
import { modernMeta } from "./modern/meta";
import { ProfessionalLayout } from "./professional/Layout";
import { professionalMeta } from "./professional/meta";
import type { ComponentType } from "react";
import {
  BUILTIN_TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
  TEMPLATE_IDS,
  type BuiltinTemplateId,
  type TemplateId,
  type TemplateLayoutProps,
} from "./types";
import { fetchUploadedTemplate, listUploadedTemplates } from "./uploaded/fetch";
import type { UploadedTemplate } from "./uploaded/types";

export type TemplateMeta = {
  id: TemplateId;
  name: string;
  description: string;
  isRecommended?: boolean;
  Layout: ComponentType<TemplateLayoutProps>;
};

export const TEMPLATES: TemplateMeta[] = [
  { ...professionalMeta, Layout: ProfessionalLayout },
  { ...classicMeta, Layout: ClassicLayout },
  { ...modernMeta, Layout: ModernLayout },
];

export function resolveTemplateId(id: string | null | undefined): TemplateId {
  if (id == null || id === "") return DEFAULT_TEMPLATE_ID;
  return id;
}

export function getTemplateMeta(id: string | null | undefined): TemplateMeta {
  const resolved = resolveTemplateId(id);
  return TEMPLATES.find((t) => t.id === resolved) ?? TEMPLATES[0];
}

export function getTemplateLayout(id: string | null | undefined) {
  return getTemplateMeta(id).Layout;
}

export type ResolvedTemplateMeta =
  | { source: "builtin"; id: BuiltinTemplateId; meta: TemplateMeta }
  | { source: "uploaded"; id: string; template: UploadedTemplate };

function isBuiltinId(id: string): id is BuiltinTemplateId {
  return (BUILTIN_TEMPLATE_IDS as readonly string[]).includes(id);
}

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
  // Fallback to default built-in
  const fallback = TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
  return { source: "builtin", id: DEFAULT_TEMPLATE_ID, meta: fallback };
}

export type AllTemplatesItem = {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string | null;
  source: "builtin" | "uploaded";
  isRecommended?: boolean;
};

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

export { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, BUILTIN_TEMPLATE_IDS };
export type { TemplateId, BuiltinTemplateId, TemplateLayoutProps };
