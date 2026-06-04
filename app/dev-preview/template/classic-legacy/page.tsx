/**
 * DEV-ONLY: legacy React classic baseline for migrating the built-in classic
 * template to HTML/CSS SlotRenderer.
 *
 * This intentionally bypasses getTemplateMetaAsync so it keeps rendering the
 * old React component even after builtin ids are routed through unified.
 */
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { demoResume } from "@/lib/demo-resume";

export const dynamic = "force-dynamic";

export default function ClassicLegacyPreview() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-[800px]">
        <ClassicLayout
          content={demoResume}
          sectionOrder={demoResume.sectionOrder}
          styleSettings={demoResume.styleSettings}
        />
      </div>
    </main>
  );
}
