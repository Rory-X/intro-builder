import { SlotRenderer } from "./uploaded/html-slot-renderer";
import { getTemplateMetaAsync } from "./registry-server";
import type { ResolvedTemplateMeta } from "./registry";
import type { TemplateLayoutProps } from "./types";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";

/**
 * Server-side: resolve `id` (built-in or DB-stored) to the HTML+CSS template
 * and render via SlotRenderer. Use this in **server components** (preview /
 * share pages, dashboard, PDF route — any place that already had access
 * to `await`).
 *
 * Pulls in the DB module graph via `getTemplateMetaAsync`, so this file
 * is server-only. Client-side helpers (
 * `ClientTemplateRenderFromSerializable`, `toSerializable`,
 * `SerializableResolvedTemplate`) live in `./render.tsx`.
 *
 * `preResolved` short-circuits the async lookup — pass it when the
 * caller already has the resolved meta in hand (e.g. dashboard
 * pre-fetches all uploaded templates once and renders many cards).
 */
export async function TemplateRender({
  id,
  preResolved,
  ...layoutProps
}: {
  id: string | null | undefined;
  preResolved?: ResolvedTemplateMeta;
} & TemplateLayoutProps) {
  const resolved = preResolved ?? (await getTemplateMetaAsync(id));
  const template = resolved.template;

  if (!template.html) {
    throw new Error(
      `[render-server] Template "${resolved.id}" has no HTML content. ` +
      `All templates must have HTML (v2 SlotRenderer path).`
    );
  }

  return (
    <SlotRenderer
      html={template.html}
      css={template.css}
      content={layoutProps.content}
      styleSettings={layoutProps.styleSettings ?? DEFAULT_STYLE_SETTINGS}
      templateId={template.id}
      sectionIcons={template.layout.sectionIcons}
    />
  );
}
