import { UploadedLayout } from "./uploaded/UploadedLayout";
import { getTemplateMetaAsync } from "./registry-server";
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
 */
export async function TemplateRender({
  id,
  ...layoutProps
}: { id: string | null | undefined } & TemplateLayoutProps) {
  const resolved = await getTemplateMetaAsync(id);
  if (resolved.source === "builtin") {
    const Layout = resolved.meta.Layout;
    return <Layout {...layoutProps} />;
  }
  return <UploadedLayout {...layoutProps} template={resolved.template} />;
}
