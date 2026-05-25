/**
 * Backfill: add `frame: { kind: "vertical" }` to existing rows whose layout
 * was inserted before the frame schema landed. After this, every row in DB
 * conforms to the strict LayoutConfig shape — no graceful-degradation fallback
 * needed at read time.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/backfill-frame-vertical.ts
 *
 * Idempotent: rows that already have a `frame` key are skipped. Safe to
 * re-run.
 */
import { neon } from "@neondatabase/serverless";

/**
 * Wraps a Neon HTTP fetch in retries for ECONNRESET / fetch failed —
 * those are common on the China → ap-southeast-1 path and don't mean
 * the operation actually failed; they're transport hiccups.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /fetch failed|ECONNRESET|socket disconnected|network socket/i.test(
        msg + (e instanceof Error && (e as Error & { cause?: { code?: string } }).cause?.code
          ? ` ${(e as Error & { cause?: { code?: string } }).cause?.code}`
          : ""),
      );
      if (!transient || i === maxAttempts) throw e;
      const delay = 500 * 2 ** (i - 1);
      console.warn(`  ! ${label} attempt ${i} hit transient error, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set — pass --env-file=.env.local");
  const sql = neon(dbUrl);

  const rows = await withRetry(
    "select",
    () =>
      sql`SELECT id, layout FROM templates` as Promise<
        Array<{ id: string; layout: { frame?: unknown } & Record<string, unknown> }>
      >,
  );

  console.log(`scanning ${rows.length} template row(s)`);

  let backfilled = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.layout && typeof row.layout === "object" && "frame" in row.layout) {
      console.log(`  • ${row.id} — already has frame, skip`);
      skipped++;
      continue;
    }
    const newLayout = { frame: { kind: "vertical" }, ...row.layout };
    await withRetry(
      `update ${row.id}`,
      () => sql`
        UPDATE templates
        SET layout = ${JSON.stringify(newLayout)}::jsonb,
            "updatedAt" = now()
        WHERE id = ${row.id}
      `,
    );
    console.log(`  • ${row.id} — backfilled frame=vertical`);
    backfilled++;
  }

  console.log(`\ndone: ${backfilled} backfilled, ${skipped} already had frame`);

  const verify = await withRetry(
    "verify",
    () =>
      sql`SELECT id, layout->'frame' AS frame FROM templates ORDER BY id` as Promise<
        Array<{ id: string; frame: unknown }>
      >,
  );
  console.log("\nverification (every row should have a frame now):");
  for (const v of verify) {
    console.log(`  • ${v.id}  frame=${JSON.stringify(v.frame)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
