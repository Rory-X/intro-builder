import type { StyleSettings } from "@intro-builder/shared/schemas";
import type { TemplateId, TemplateLayoutProps } from "./types";
import type { UploadedTemplate } from "./uploaded/types";

/**
 * Client-safe template registry types.
 *
 * Runtime template data lives in the DB and must be fetched by server code.
 * This module intentionally exports only serializable shapes and pure types so
 * client components never import DB, filesystem, or local template metadata.
 */

export type TemplateCategory =
  | "academic"
  | "tech"
  | "business"
  | "creative"
  | "general";

export type ResolvedTemplateMeta = {
  source: "uploaded";
  id: string;
  template: UploadedTemplate;
};

export type AllTemplatesItem = {
  id: string;
  name: string;
  /** Coerced to "" at the registry-server boundary; never null at this layer. */
  description: string;
  thumbnailUrl: string | null;
  source: "uploaded";
  defaultStyleSettings: StyleSettings;
  category?: TemplateCategory;
  /** 抽屉里"这个模板的特点"渲染。null/undefined 时抽屉降级为通用文案（不报错）。 */
  features?: [string, string, string] | string[];
  tags?: string[];
};

export type { TemplateId, TemplateLayoutProps };
