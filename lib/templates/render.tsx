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
  | { source: "unified"; id: string; html: string; css: string | null; templateId: string; sidebarSections?: string[] };

export function toSerializable(
  resolved: ResolvedTemplateMeta,
): SerializableResolvedTemplate {
  if (resolved.source === "builtin") {
    return { source: "builtin", id: resolved.id };
  }
  // uploaded 模板有 customHtml 时走 unified 路径（SlotRenderer）
  const t = resolved.template;
  if (t.customHtml) {
    const tplLayout = (t as Record<string, unknown>).templateLayout as
      | { type: string; sidebar?: { sections?: string[] } }
      | null;
    const sidebarSections =
      tplLayout?.type === "horizontal" ? tplLayout.sidebar?.sections : undefined;
    return {
      source: "unified",
      id: resolved.id,
      html: t.customHtml,
      css: t.customCss,
      templateId: t.id,
      sidebarSections,
    };
  }
  return {
    source: "uploaded",
    id: resolved.id,
    template: resolved.template,
  };
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
  // v2 统一路径：html 字段存在，直接走 SlotRenderer
  if (resolved.source === "unified") {
    return (
      <SlotRenderer
        html={resolved.html}
        css={resolved.css}
        content={layoutProps.content}
        styleSettings={layoutProps.styleSettings ?? DEFAULT_STYLE_SETTINGS}
        templateId={resolved.templateId}
        sidebarSections={resolved.sidebarSections}
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
