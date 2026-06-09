import { notFound } from "next/navigation";
import { TemplateRender } from "@/lib/templates/render-server";
import { demoResume } from "@/lib/demo-resume";
import { fetchUploadedTemplateAnyStatus } from "@/lib/templates/uploaded/fetch";
import { DENSITY_PRESETS } from "@/lib/style-presets";
import type { ResolvedTemplateMeta } from "@/lib/templates/registry";

/**
 * Dev-only preview for draft templates.
 *
 * Fetches the template row regardless of status so skill agents can preview
 * draft templates before publishing. This route is NOT linked from the main
 * app UI — it's only accessed via the URL printed by insert-template.ts.
 *
 * Requires DATABASE_URL at runtime. Not guarded by proxy.ts auth by design:
 * draft templates are only usable when someone knows the exact template id
 * (which only the skill agent outputs).
 */
export default async function DevPreviewTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch template regardless of status (bypasses the `status='published'` filter)
  const template = await fetchUploadedTemplateAnyStatus(id);
  if (!template || !template.html) {
    notFound();
  }

  const resolved: ResolvedTemplateMeta = {
    source: "uploaded",
    id: template.id,
    template,
  };

  const styleSettings =
    (template as { defaultStyleSettings?: typeof DENSITY_PRESETS.standard.settings })
      .defaultStyleSettings ?? DENSITY_PRESETS.standard.settings;

  return (
    <div>
      {/* Draft indicator banner */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: "#fbbf24",
          color: "#000",
          textAlign: "center",
          padding: "4px 12px",
          fontSize: "13px",
          fontWeight: 600,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        ⚠️ DRAFT 预览 —— 模板 ID: {id} ({template.name})
      </div>

      <div style={{ paddingTop: "36px" }} className="bg-slate-100 min-h-screen py-8">
        <TemplateRender
          id={template.id}
          preResolved={resolved}
          content={demoResume}
          sectionOrder={demoResume.sectionOrder}
          styleSettings={styleSettings}
        />
      </div>
    </div>
  );
}
