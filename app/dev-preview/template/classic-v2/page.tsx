/**
 * DEV-ONLY: PoC for porting built-in `classic` template to the v2
 * SlotRenderer pipeline (HTML+slot+customCss).
 *
 * Visit /dev-preview/template/classic-v2. Reads the slot-ified HTML
 * from prototypes/classic-v2/, splits inline <style>, feeds demoResume
 * to SlotRenderer.
 *
 * Compare visually to the built-in `classic` rendered at:
 *   /resume/<id>/edit (with classic template selected)
 *
 * proxy.ts doesn't list this in PROTECTED, so no login enforced.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SlotRenderer } from "@/lib/templates/uploaded/html-slot-renderer";
import { demoResume } from "@/lib/demo-resume";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";

export const dynamic = "force-dynamic";

export default function ClassicV2PocPreview() {
  const filePath = path.join(
    process.cwd(),
    "prototypes/classic-v2/index-with-slots.html",
  );
  const fileContent = readFileSync(filePath, "utf-8");
  const { html, css } = splitHtmlCss(fileContent);

  return (
    <main className="min-h-screen bg-zinc-200 p-8">
      <header className="mx-auto mb-6 flex max-w-[800px] items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs text-zinc-500">Dev preview · 不走鉴权 · classic → v2 PoC</p>
          <h1 className="text-lg font-semibold">
            classic-v2{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
              SlotRenderer
            </span>{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
              prototype
            </span>
          </h1>
        </div>
        <div className="text-xs text-zinc-500">
          对照 built-in classic 视觉
        </div>
      </header>
      <div className="mx-auto max-w-[800px]">
        <SlotRenderer
          html={html}
          css={css}
          content={demoResume}
          styleSettings={DEFAULT_STYLE_SETTINGS}
          templateId="classic-v2"
        />
      </div>
    </main>
  );
}

function splitHtmlCss(fileContent: string): { html: string; css: string } {
  const styleBlocks: string[] = [];
  const html = fileContent.replace(
    /<style[^>]*>([\s\S]*?)<\/style>/gi,
    (_, body: string) => {
      styleBlocks.push(body);
      return "";
    },
  );
  return { html: html.trim(), css: styleBlocks.join("\n") };
}
