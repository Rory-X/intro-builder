/**
 * DEV-ONLY: legacy React modern baseline for migrating the built-in modern
 * template to HTML/CSS SlotRenderer.
 *
 * This intentionally bypasses getTemplateMetaAsync so it keeps rendering the
 * old React component even after builtin ids are routed through unified.
 */
import { ModernLayout } from "@/lib/templates/modern/Layout";
import { demoResume } from "@/lib/demo-resume";

export const dynamic = "force-dynamic";

export default function ModernLegacyPreview() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-[840px]">
        <ModernLayout
          content={demoResume}
          sectionOrder={demoResume.sectionOrder}
          styleSettings={demoResume.styleSettings}
        />
      </div>
    </main>
  );
}
