import {
  TEMPLATES,
  type ResolvedTemplateMeta,
} from "./registry";
import type {
  BuiltinTemplateId,
  TemplateLayoutProps,
} from "./types";
import { UploadedLayout } from "./uploaded/UploadedLayout";
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
 * Discriminated union without the non-serializable `Layout` ComponentType
 * that lives on `ResolvedTemplateMeta`. Cross the SC → CC boundary as
 * this shape and rebuild the renderer on the client side via
 * {@link ClientTemplateRenderFromSerializable}.
 *
 * Why a separate type: `ResolvedTemplateMeta.meta.Layout` is a React
 * component reference. Next.js's RSC serializer cannot stream component
 * references through a server-component → client-component boundary, so
 * passing the raw resolved value crashes at render time.
 */
export type SerializableResolvedTemplate =
  | { source: "builtin"; id: BuiltinTemplateId }
  | { source: "uploaded"; id: string; template: UploadedTemplate };

/**
 * Project a registry resolution into something safe to pass through the
 * SC → CC boundary as a prop. Pure data transform — no DB / IO — so it's
 * safe to import from either server or client code.
 */
export function toSerializable(
  resolved: ResolvedTemplateMeta,
): SerializableResolvedTemplate {
  if (resolved.source === "builtin") {
    return { source: "builtin", id: resolved.id };
  }
  return {
    source: "uploaded",
    id: resolved.id,
    template: resolved.template,
  };
}

/**
 * Client-side: caller already has the resolved template (passed in from
 * a server component, or selected from a client-side template list). The
 * built-in `Layout` is rebuilt by id lookup against the static
 * `TEMPLATES` array; uploaded templates carry their full data.
 *
 * Falls back to the first built-in if a built-in id no longer exists —
 * keeps the editor from crashing when stale state references a removed
 * template.
 */
export function ClientTemplateRenderFromSerializable({
  resolved,
  ...layoutProps
}: { resolved: SerializableResolvedTemplate } & TemplateLayoutProps) {
  if (resolved.source === "builtin") {
    const meta = TEMPLATES.find((t) => t.id === resolved.id) ?? TEMPLATES[0];
    const Layout = meta.Layout;
    return <Layout {...layoutProps} />;
  }
  return <UploadedLayout {...layoutProps} template={resolved.template} />;
}

export type { ResolvedTemplateMeta };
