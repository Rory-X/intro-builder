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
import type { UploadedTemplate } from "./uploaded/types";

/**
 * Client-safe template registry.
 *
 * This module is imported by client components (style editor, smart-layout
 * button, editor-client preview), so it MUST NOT pull in any server-only
 * code. Anything that talks to the DB (`getTemplateMetaAsync`,
 * `listAllTemplatesAsync`) lives in `./registry-server.ts`.
 * Top-level imports are transitive — even an unused `getTemplateMetaAsync`
 * import from a client file would drag the whole `db` module graph (postgres /
 * fs / net) into the browser bundle, breaking the build.
 *
 * `AllTemplatesItem` is the *return shape* of the server-side merge — it's a
 * pure data type with no runtime, so it lives here (next to other type-only
 * exports) and the server fetcher/the client UI can both import it without
 * either pulling DB code into the client bundle.
 */

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

/**
 * Lightweight projection of every selectable template (built-in + uploaded)
 * for picker UIs. Built-in items have `thumbnailUrl: null` because their
 * preview is rendered live; uploaded items may have `thumbnailUrl: null`
 * during the foundation phase (no thumbnail uploaded yet) — the UI must
 * tolerate both and show a name placeholder when there's no thumbnail.
 */
export type AllTemplatesItem = {
  id: string;
  name: string;
  /** Coerced to "" at the registry-server boundary; never null at this layer. */
  description: string;
  thumbnailUrl: string | null;
  source: "builtin" | "uploaded";
  isRecommended?: boolean;
};

export { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, BUILTIN_TEMPLATE_IDS };
export type { TemplateId, BuiltinTemplateId, TemplateLayoutProps };
