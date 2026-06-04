import {
  TEMPLATES,
  type ResolvedTemplateMeta,
} from "./registry";
import type {
  BuiltinTemplateId,
  TemplateLayoutProps,
} from "./types";
import { UploadedLayout } from "./uploaded/UploadedLayout";
import { SlotRenderer } from "./uploaded/html-slot-renderer";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";
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
 * v2 统一路径：优先看 html 字段。有 html 则走 SlotRenderer，
 * 没有 html 走旧路径（builtin React 组件或 v1 enum）作为 fallback。
 */
export type SerializableResolvedTemplate =
  | { source: "builtin"; id: BuiltinTemplateId }
  | { source: "uploaded"; id: string; template: UploadedTemplate }
  | { source: "unified"; id: string; html: string; css: string | null; templateId: string; sectionIcons?: Record<string, { icon: string; color?: string }> };

export function uploadedTemplateToSerializable(
  id: string,
  template: UploadedTemplate,
): SerializableResolvedTemplate {
  if (template.customHtml) {
    return {
      source: "unified",
      id,
      html: template.customHtml,
      css: template.customCss,
      templateId: template.id,
      sectionIcons: template.layout.sectionIcons,
    };
  }
  return {
    source: "uploaded",
    id,
    template,
  };
}

export function toSerializable(
  resolved: ResolvedTemplateMeta,
): SerializableResolvedTemplate {
  if (resolved.source === "builtin") {
    return { source: "builtin", id: resolved.id };
  }
  // uploaded 模板有 customHtml 时走 unified 路径（SlotRenderer）
  return uploadedTemplateToSerializable(resolved.id, resolved.template);
}

/**
 * Client-side render dispatcher.
 *
 * 优先级：unified (html 字段) > uploaded (customHtml/v1) > builtin (React 组件)
 */
export function ClientTemplateRenderFromSerializable({
  resolved,
  ...layoutProps
}: { resolved: SerializableResolvedTemplate } & TemplateLayoutProps) {
  // Debug: 确认走的是哪条路径
  if (typeof window !== "undefined") {
    console.log("[render] source:", resolved.source, "id:", resolved.source === "unified" ? resolved.templateId : resolved.id);
  }

  // v2 统一路径：html 字段存在，直接走 SlotRenderer
  if (resolved.source === "unified") {
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

  // Fallback: builtin React 组件
  if (resolved.source === "builtin") {
    const meta = TEMPLATES.find((t) => t.id === resolved.id) ?? TEMPLATES[0];
    const Layout = meta.Layout;
    return <Layout {...layoutProps} />;
  }

  // Fallback: uploaded (customHtml 或 v1 enum)
  return <UploadedLayout {...layoutProps} template={resolved.template} />;
}

export type { ResolvedTemplateMeta };
