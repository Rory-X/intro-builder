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

export { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, BUILTIN_TEMPLATE_IDS };
export type { TemplateId, BuiltinTemplateId, TemplateLayoutProps };
