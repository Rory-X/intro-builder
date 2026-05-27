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
 * 模板归类（用户视角，决定模板库 tab）。
 * 选 category 时想"这个模板最适合哪类岗位 / 求职者"，不想视觉结构。
 *
 * - academic：科研 / 院校 / 高校教职 / postdoc
 * - tech：互联网产品 / 技术 / 设计 / 运营（字节 / 阿里 / 美团 / 腾讯）
 * - business：金融 / 咨询 / 律所 / 银行 / 国企 / 快消（保守行业）
 * - creative：设计师 / 艺术 / 传媒 / 营销（视觉表达岗）
 * - general：跨场景通用，应届 / 年轻求职者 / 不挑行业
 *
 * 加新分类时同步：tab UI、insert-template.ts 校验、SKILL.md 命名规范。
 */
export type TemplateCategory =
  | "academic"
  | "tech"
  | "business"
  | "creative"
  | "general";

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
  /** 用户视角分类，决定模板库 tab 归属。所有 builtin 必填，uploaded 走 DB 字段。 */
  category: TemplateCategory;
  /**
   * 抽屉里"这个模板的特点"显示的 3 条 per-template 文案。
   * 写"适合谁 + 视觉特点 + 实用提示"，每条 ≤ 30 字，**避免**通用废话
   *（"应用后样式 100% 一致" 这种所有模板都适用的不是模板特点）。
   */
  features: [string, string, string];
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
  /** 抽屉里"这个模板的特点"渲染。null/undefined 时抽屉降级为通用文案（不报错）。 */
  features?: [string, string, string] | string[];
  tags?: string[];
};

export { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, BUILTIN_TEMPLATE_IDS };
export type { TemplateId, BuiltinTemplateId, TemplateLayoutProps };
