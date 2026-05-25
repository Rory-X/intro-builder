/**
 * Insert one row into the `templates` table. Used by the template-studio skill
 * after extract-decoration.py produces the background image and the agent
 * decides on a LayoutConfig + DecorationConfig.
 *
 * Run: pnpm exec tsx --env-file=.env.local template-studio-skill/scripts/insert-template.ts \
 *        --id <id> --name "<name>" \
 *        --description "<one-line description>" \
 *        --thumbnail-url "<optional URL>" \
 *        --decoration '<DecorationConfig JSON or null>' \
 *        --layout '<LayoutConfig JSON>'
 *
 * --env-file=.env.local must be passed so DATABASE_URL is in process.env
 * before this module runs (no in-file dotenv — ESM imports evaluate before
 * top-level statements).
 *
 * Exit codes:
 *   0  inserted (or already existed and we leave it)
 *   1  caller error (missing args, bad JSON, missing DATABASE_URL)
 *   2  DB error
 */
import { neon } from "@neondatabase/serverless";
import { parseArgs } from "node:util";

type DecorationConfig = {
  bgImageUrl: string;
  placement: {
    position: "absolute";
    top: string;
    right: string;
    width: string;
    height: string;
    zIndex: number;
    opacity: number;
  };
  pageBgColor?: string;
};

type LayoutConfig = {
  headerVariant: string;
  sectionTitleVariant: string;
  itemHeaderVariant: string;
  theme: { primaryColor: string; [k: string]: unknown };
  sectionIcons: Record<string, string>;
};

function fail(code: number, msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      "thumbnail-url": { type: "string" },
      decoration: { type: "string" },
      layout: { type: "string" },
      "created-by": { type: "string" },
    },
    strict: true,
  });

  if (!values.id) fail(1, "--id required");
  if (!values.name) fail(1, "--name required");
  if (!values.layout) fail(1, "--layout required (LayoutConfig JSON)");

  // Parse + lightly validate the structured fields. We only check shape, not
  // semantics — the renderer will fail loudly on bad values, which is the
  // signal we want.
  let layout: LayoutConfig;
  try {
    layout = JSON.parse(values.layout) as LayoutConfig;
  } catch (e) {
    fail(1, `--layout is not valid JSON: ${(e as Error).message}`);
  }
  for (const k of ["headerVariant", "sectionTitleVariant", "itemHeaderVariant", "theme", "sectionIcons"] as const) {
    if (!(k in layout)) fail(1, `--layout missing field "${k}"`);
  }
  if (!layout.theme?.primaryColor) fail(1, `--layout.theme.primaryColor required`);

  let decoration: DecorationConfig | null = null;
  if (values.decoration && values.decoration !== "null") {
    try {
      decoration = JSON.parse(values.decoration) as DecorationConfig;
    } catch (e) {
      fail(1, `--decoration is not valid JSON: ${(e as Error).message}`);
    }
    if (!decoration!.bgImageUrl) fail(1, "--decoration.bgImageUrl required");
    if (!decoration!.placement) fail(1, "--decoration.placement required");
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail(1, "DATABASE_URL not set — pass --env-file=.env.local to tsx");

  const sql = neon(dbUrl);

  // Idempotent upsert: ON CONFLICT DO UPDATE so re-running the skill (e.g. after
  // tweaking the prompt or layout) refreshes the row instead of erroring.
  // RETURNING avoids a second round-trip — Neon HTTP fetches are independent
  // calls, and the second one is a flaky moment we don't need to take.
  try {
    const rows = (await sql`
      INSERT INTO templates (
        id, name, description, "thumbnailUrl",
        source, decoration, layout, status, "createdBy"
      ) VALUES (
        ${values.id},
        ${values.name},
        ${values.description ?? null},
        ${values["thumbnail-url"] ?? null},
        'uploaded',
        ${decoration ? JSON.stringify(decoration) : null}::jsonb,
        ${JSON.stringify(layout)}::jsonb,
        'published',
        ${values["created-by"] ?? "template-studio-skill"}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        "thumbnailUrl" = EXCLUDED."thumbnailUrl",
        decoration = EXCLUDED.decoration,
        layout = EXCLUDED.layout,
        status = EXCLUDED.status,
        "updatedAt" = now()
      RETURNING id, name, source, status, "updatedAt"
    `) as Array<{ id: string; name: string; source: string; status: string; updatedAt: string }>;
    if (rows.length === 0) fail(2, "no row returned from upsert");
    const r = rows[0];
    console.log(`upserted: ${r.id} (${r.name})  source=${r.source}  status=${r.status}`);
  } catch (e) {
    fail(2, `DB error: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
