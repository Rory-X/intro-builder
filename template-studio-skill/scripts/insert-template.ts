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
// Single source of truth for the row shape. Manually mirroring the Zod
// schema here would silently drift (e.g. `frame` was added to
// LayoutConfig in 1f79532; the old hand-written type didn't notice and
// would have happily inserted rows that fetch.ts then rejects).
import { LayoutConfig, DecorationConfig } from "@/lib/templates/uploaded/types";

function fail(code: number, msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

/** Parse JSON + run Zod validation; print Zod's flattened issues on failure. */
function parseConfig<T>(
  flag: string,
  raw: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } } },
): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    fail(1, `${flag} is not valid JSON: ${(e as Error).message}`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    fail(
      1,
      `${flag} failed schema validation:\n${JSON.stringify(result.error.flatten(), null, 2)}`,
    );
  }
  return result.data;
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

  // Validates against the same Zod schema fetch.ts uses to read — no drift
  // possible. If LayoutConfig grows a new required field, this script will
  // start rejecting Skill output the moment the schema lands, instead of
  // silently writing rows that vanish from listAllTemplatesAsync.
  const layout = parseConfig("--layout", values.layout, LayoutConfig);

  const decoration =
    values.decoration && values.decoration !== "null"
      ? parseConfig("--decoration", values.decoration, DecorationConfig)
      : null;

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
