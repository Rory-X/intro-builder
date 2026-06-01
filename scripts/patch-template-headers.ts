/**
 * One-shot patch: inject missing basics bindings into existing v2 templates.
 *
 * Problem: abbey-blue and handcoded-crimson were inserted with only
 * basics.name / basics.phone / basics.email in the header. Missing:
 * basics.photo, basics.title, basics.status, basics.location, basics.website.
 *
 * This script patches the customHtml in-place per template (structure-aware
 * injection), then upserts the fixed HTML back to DB.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/patch-template-headers.ts
 *
 * Idempotent: if bindings already present, no-op for that template.
 */
import { neon } from "@neondatabase/serverless";

const REQUIRED_BINDINGS = [
  "basics.photo",
  "basics.name",
  "basics.title",
  "basics.status",
  "basics.email",
  "basics.phone",
  "basics.location",
  "basics.website",
] as const;

function getMissing(html: string): string[] {
  return REQUIRED_BINDINGS.filter(
    (b) => !new RegExp(`data-bind=["']${b.replace(".", "\\.")}["']`).test(html),
  );
}

/**
 * abbey-blue: centered header with avatar on top.
 * Current structure:
 *   <img data-bind="basics.photo" .../>
 *   <h1 ...><slot data-bind="basics.name"></slot></h1>
 *   <div class="abbey-blue-contact">phone | email</div>
 *
 * Patch: add title+status line after h1, add location+website to contact.
 */
function patchAbbeyBlue(html: string): string {
  // Add title + status after the name h1
  html = html.replace(
    /(<h1 class="abbey-blue-name"><slot data-bind="basics\.name"><\/slot><\/h1>)/,
    `$1\n    <div class="abbey-blue-subtitle"><slot data-bind="basics.title"></slot><span class="sep">·</span><slot data-bind="basics.status"></slot></div>`,
  );

  // Replace contact div to include location + website
  html = html.replace(
    /<div class="abbey-blue-contact">\s*<span><slot data-bind="basics\.phone"><\/slot><\/span>\s*<span class="sep">\|<\/span>\s*<span><slot data-bind="basics\.email"><\/slot><\/span>\s*<\/div>/,
    `<div class="abbey-blue-contact">
      <span><slot data-bind="basics.phone"></slot></span>
      <span class="sep">|</span>
      <span><slot data-bind="basics.email"></slot></span>
      <span class="sep">|</span>
      <span><slot data-bind="basics.location"></slot></span>
      <span class="sep">|</span>
      <span><slot data-bind="basics.website"></slot></span>
    </div>`,
  );

  return html;
}

/**
 * handcoded-crimson: banner with avatar placeholder + name + contact.
 * Current structure:
 *   <div class="avatar-placeholder" ...></div>
 *   <div class="banner-text">
 *     <h1>name</h1>
 *     <div class="contact">phone | email</div>
 *   </div>
 *
 * Patch: replace avatar-placeholder with real img, add title+status, add location+website.
 */
function patchHandcodedCrimson(html: string): string {
  // Replace avatar placeholder with real img binding
  html = html.replace(
    /<div class="avatar-placeholder" aria-hidden="true"><\/div>/,
    `<img data-bind="basics.photo" alt="头像" class="crimson-avatar" />`,
  );

  // Add title + status after h1
  html = html.replace(
    /(<h1><slot data-bind="basics\.name"><\/slot><\/h1>)\s*(<div class="contact">)/,
    `$1\n      <div class="subtitle"><slot data-bind="basics.title"></slot><span> · </span><slot data-bind="basics.status"></slot></div>\n      $2`,
  );

  // Expand contact to include location + website
  html = html.replace(
    /<div class="contact">\s*<slot data-bind="basics\.phone"><\/slot>\s*<span>　\|　<\/span>\s*<slot data-bind="basics\.email"><\/slot>\s*<\/div>/,
    `<div class="contact">
        <slot data-bind="basics.phone"></slot>
        <span>　|　</span>
        <slot data-bind="basics.email"></slot>
        <span>　|　</span>
        <slot data-bind="basics.location"></slot>
        <span>　|　</span>
        <slot data-bind="basics.website"></slot>
      </div>`,
  );

  return html;
}

/** Patch CSS for crimson: add .crimson-avatar + .subtitle styles */
function patchCrimsonCss(css: string): string {
  if (css.includes(".crimson-avatar")) return css; // already patched

  const avatarCss = `
  .crimson-avatar {
    width: 70px; height: 70px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
    z-index: 1;
  }
  .crimson-banner .subtitle {
    font-size: 13px;
    opacity: 0.9;
    margin-top: 2px;
  }`;

  // Insert after .crimson-banner .banner-text rule
  const insertPoint = css.indexOf(".crimson-banner h1");
  if (insertPoint === -1) {
    return css + avatarCss;
  }
  return css.slice(0, insertPoint) + avatarCss + "\n  " + css.slice(insertPoint);
}

/** Patch CSS for abbey-blue: add .abbey-blue-subtitle style */
function patchAbbeyBlueCss(css: string): string {
  if (css.includes(".abbey-blue-subtitle")) return css; // already patched

  const subtitleCss = `
  .abbey-blue-subtitle {
    margin-top: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .abbey-blue-subtitle .sep { color: var(--subtle); margin: 0 4px; }`;

  // Insert after .abbey-blue-contact rule
  const insertPoint = css.indexOf(".abbey-blue-section");
  if (insertPoint === -1) {
    return css + subtitleCss;
  }
  return css.slice(0, insertPoint) + subtitleCss + "\n\n  " + css.slice(insertPoint);
}

const PATCHERS: Record<string, {
  html: (h: string) => string;
  css: (c: string) => string;
}> = {
  "abbey-blue": { html: patchAbbeyBlue, css: patchAbbeyBlueCss },
  "handcoded-crimson": { html: patchHandcodedCrimson, css: patchCrimsonCss },
};

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(dbUrl);
  const rows = await sql`
    SELECT id, name, "customHtml", "customCss"
    FROM templates
    WHERE source = 'uploaded' AND "customHtml" IS NOT NULL
    ORDER BY id
  ` as Array<{ id: string; name: string; customHtml: string; customCss: string | null }>;

  let patched = 0;

  for (const row of rows) {
    const missing = getMissing(row.customHtml);
    if (missing.length === 0) {
      console.log(`✓ ${row.id} (${row.name}) — all bindings present`);
      continue;
    }

    console.log(`✗ ${row.id} (${row.name}) — missing: ${missing.join(", ")}`);

    const patcher = PATCHERS[row.id];
    if (!patcher) {
      console.log(`  ⚠ no patcher defined for ${row.id} — skipping (add one to this script)`);
      continue;
    }

    const newHtml = patcher.html(row.customHtml);
    const newCss = patcher.css(row.customCss ?? "");

    // Verify patch worked
    const stillMissing = getMissing(newHtml);
    if (stillMissing.length > 0) {
      console.log(`  ⚠ patch incomplete, still missing: ${stillMissing.join(", ")}`);
      continue;
    }

    // Update DB
    await sql`
      UPDATE templates
      SET "customHtml" = ${newHtml}, "customCss" = ${newCss}, "updatedAt" = now()
      WHERE id = ${row.id}
    `;
    console.log(`  ✓ patched and saved to DB`);
    patched++;
  }

  console.log(`\nDone: ${patched} template(s) patched, ${rows.length - patched} unchanged/skipped`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
