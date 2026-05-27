/**
 * DEV-ONLY: validate the Skill v2 SlotRenderer end-to-end with the
 * crimson PoC HTML before any DB row is involved.
 *
 * Visit /dev-preview/template/handcoded-crimson. Reads the slot-ified
 * HTML from prototypes/ at request time, splits inline <style> from
 * the body, feeds the demo resume to SlotRenderer.
 *
 * Compare visually to docs/handcoded-crimson-banner-png-v4.png — the
 * PoC reference image. Aim ≥ 90% visual match.
 *
 * proxy.ts doesn't list this in PROTECTED, so no login enforced.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SlotRenderer } from "@/lib/templates/uploaded/html-slot-renderer";
import { demoResume } from "@/lib/demo-resume";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";

export const dynamic = "force-dynamic";

export default function CrimsonPocPreview() {
  const filePath = path.join(
    process.cwd(),
    "prototypes/handcoded-crimson/index-with-slots.html",
  );
  const fileContent = readFileSync(filePath, "utf-8");
  const { html, css } = splitHtmlCss(fileContent);

  return (
    <main className="min-h-screen bg-zinc-200 p-8">
      <header className="mx-auto mb-6 flex max-w-[800px] items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs text-zinc-500">Dev preview · 不走鉴权 · Skill v2 PoC</p>
          <h1 className="text-lg font-semibold">
            handcoded-crimson{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
              SlotRenderer
            </span>{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
              prototype
            </span>
          </h1>
        </div>
        <a
          href="/docs/handcoded-crimson-banner-png-v4.png"
          target="_blank"
          rel="noopener"
          className="text-xs text-blue-600 underline"
        >
          对照 v4 参考图 →
        </a>
      </header>
      <div className="mx-auto max-w-[800px]">
        <SlotRenderer
          html={html}
          css={css}
          content={demoResume}
          styleSettings={DEFAULT_STYLE_SETTINGS}
          templateId="handcoded-crimson"
        />
      </div>
    </main>
  );
}

/**
 * Pull every <style>...</style> block out into a CSS string, leaving the
 * rest of the HTML to feed the renderer. Multiple <style> blocks are
 * concatenated. Skill v2 production templates store HTML and CSS in
 * separate DB columns; this preview reads both from one file for
 * convenience.
 */
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
