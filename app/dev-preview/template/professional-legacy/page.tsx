/**
 * DEV-ONLY: legacy React professional baseline for migrating the built-in
 * professional template to HTML/CSS SlotRenderer.
 *
 * This intentionally bypasses getTemplateMetaAsync so it keeps rendering the
 * old React component even after builtin ids are routed through unified.
 */
import { ProfessionalLayout } from "@/lib/templates/professional/Layout";
import { demoResume } from "@/lib/demo-resume";

export const dynamic = "force-dynamic";

export default function ProfessionalLegacyPreview() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-[800px]">
        <ProfessionalLayout
          content={demoResume}
          sectionOrder={demoResume.sectionOrder}
          styleSettings={demoResume.styleSettings}
        />
      </div>
    </main>
  );
}
