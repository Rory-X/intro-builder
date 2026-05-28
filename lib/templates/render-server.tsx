import { UploadedLayout } from "./uploaded/UploadedLayout";
import { getTemplateMetaAsync } from "./registry-server";
import type { ResolvedTemplateMeta } from "./registry";
import type { TemplateLayoutProps } from "./types";

/**
 * Server-side: resolve `id` (built-in or DB-stored) to the right Layout
 * component and render it. Use this in **server components** (preview /
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
 * pre-fetches all uploaded templates once and renders many cards). This
 * collapses what would otherwise be N+1 DB roundtrips into a single
 * batch query at the page level. When omitted, falls back to the
 * original async path so single-render callers don't have to know about
 * the optimization.
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
  if (resolved.source === "builtin") {
    const Layout = resolved.meta.Layout;
    return <Layout {...layoutProps} />;
  }
  return <UploadedLayout {...layoutProps} template={resolved.template} />;
}
