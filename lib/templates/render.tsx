import type {
  BuiltinTemplateId,
  TemplateLayoutProps,
} from "./types";
import { SlotRenderer } from "./uploaded/html-slot-renderer";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";
import type { ResolvedTemplateMeta } from "./registry";
import type { UploadedTemplate } from "./uploaded/types";

/**
 * Client-safe render dispatcher helpers.
 *
 * The async server-side `<TemplateRender id={...}>` component lives in
 * `./render-server.tsx` because it imports the DB-touching
 * `getTemplateMetaAsync` from `./registry-server.ts`. Keeping that out of
 * this file means client components can import the serializable type +
 * the sync dispatcher without dragging the postgres module graph into
 * the browser bundle.
 */

/**
 * Serializable template shape for crossing the SC → CC boundary.
 *
 * v2 统一路径：所有模板都走 SlotRenderer（HTML+CSS slot-driven）。
 * `source: "builtin"` 保留用于客户端尚未获得 HTML 数据时的占位标记，
 * 实际渲染时会抛错（所有 builtin 应在 server 端被预解析为 unified）。
 */
export type SerializableResolvedTemplate =
  | { source: "builtin"; id: BuiltinTemplateId }
  | { source: "unified"; id: string; html: string; css: string | null; templateId: string; sectionIcons?: Record<string, { icon: string; color?: string }> };

export function uploadedTemplateToSerializable(
  id: string,
  template: UploadedTemplate,
): SerializableResolvedTemplate {
  if (!template.html) {
    throw new Error(
      `[render] Template "${id}" has no HTML content — cannot render. ` +
      `All templates must have HTML (v2 SlotRenderer path).`
    );
  }
  return {
    source: "unified",
    id,
    html: template.html,
    css: template.css,
    templateId: template.id,
    sectionIcons: template.layout.sectionIcons,
  };
}

export function toSerializable(
  resolved: ResolvedTemplateMeta,
): SerializableResolvedTemplate {
  return uploadedTemplateToSerializable(resolved.id, resolved.template);
}

/**
 * Client-side render dispatcher.
 *
 * v2 统一路径：所有模板走 SlotRenderer。
 * source: "builtin" 是不该到达的 fallback——如果到了说明 server 端没有
 * 正确预解析（builtins 应全部通过 uploadedTemplates prop 下发 HTML）。
 */
export function ClientTemplateRenderFromSerializable({
  resolved,
  ...layoutProps
}: { resolved: SerializableResolvedTemplate } & TemplateLayoutProps) {
  if (resolved.source === "builtin") {
    throw new Error(
      `[render] Cannot render builtin template "${resolved.id}" — no HTML data available. ` +
      `This template should have been pre-resolved to "unified" by the server.`
    );
  }

  if (typeof window !== "undefined") {
    console.log("[render] source:", resolved.source, "id:", resolved.templateId);
  }

  return (
    <SlotRenderer
      html={resolved.html}
      css={resolved.css}
      content={layoutProps.content}
      styleSettings={layoutProps.styleSettings ?? DEFAULT_STYLE_SETTINGS}
      templateId={resolved.templateId}
      sectionIcons={resolved.sectionIcons}
    />
  );
}

export type { ResolvedTemplateMeta };
