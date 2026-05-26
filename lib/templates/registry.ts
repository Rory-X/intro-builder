import { ClassicLayout } from "./classic/Layout";
import { classicMeta } from "./classic/meta";
import { ModernLayout } from "./modern/Layout";
import { modernMeta } from "./modern/meta";
import { ProfessionalLayout } from "./professional/Layout";
import { professionalMeta } from "./professional/meta";
import type { ComponentType } from "react";
import type { StyleSettings } from "@/lib/resume-schema";
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

/**
 * 模板归类。spec §3.2 列了 5 类：
 * - simple：单栏文字（ATS 友好类）
 * - timeline：左侧时间轴 / 鳃骨视觉
 * - twocol：双栏 / 侧栏（含 sidebar 风）
 * - creative：装饰性强（用 decoration 图）
 * - academic：偏学术 / 简朴
 *
 * 加新分类时同步更新 spec 与 gallery 抽屉的 tag 显示。
 */
export type TemplateCategory =
  | "simple"
  | "timeline"
  | "twocol"
  | "creative"
  | "academic";

export type TemplateMeta = {
  id: TemplateId;
  name: string;
  description: string;
  isRecommended?: boolean;
  Layout: ComponentType<TemplateLayoutProps>;
  /**
   * 应用此模板时使用的默认排版设置。setTemplate(resetStyleSettings:true) 会
   * 把这份写入简历的 styleSettings —— 让"切换模板=切换匹配的字号/行距/边距"
   * 这个心智模型成立，否则 modern（紧凑双栏）会被上一个模板的 fontSize=15
   * 撑爆布局。
   */
  defaultStyleSettings: StyleSettings;
  category?: TemplateCategory;
  tags?: string[];
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
  /** Surfaced from TemplateMeta (builtin) or registry-server fallback (uploaded). */
  defaultStyleSettings: StyleSettings;
  category?: TemplateCategory;
  tags?: string[];
};

export { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, BUILTIN_TEMPLATE_IDS };
export type { TemplateId, BuiltinTemplateId, TemplateLayoutProps };
