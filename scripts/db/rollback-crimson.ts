import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const tries = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    for (let i = 1; i <= 5; i++) {
      try { return await fn(); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (i === 5 || !/fetch failed|ECONNRESET|TLS|handshake/i.test(msg)) throw e;
        console.warn(`${label} attempt ${i} transient — retry`);
        await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
      }
    }
    throw new Error("unreachable");
  };

  // 1. Hide crimson-banner from listAllTemplatesAsync (status -> draft)
  await tries("hide crimson-banner", () =>
    sql`UPDATE templates SET status='draft', "updatedAt"=now() WHERE id='crimson-banner'`
  );
  console.log("✓ crimson-banner hidden (status=draft)");

  // 2. Reset dev-user resume back to a known-good template
  await tries("reset resume template", () =>
    sql`UPDATE resume SET "templateId"='professional', "updatedAt"=now() WHERE id='856a0f5c-4ee1-49e2-8df9-951d3056ae04'`
  );
  console.log("✓ dev-user resume back to professional");

  const rows = await tries("verify", () =>
    sql`SELECT id, name, status FROM templates ORDER BY id` as unknown as Promise<Array<{ id: string; name: string; status: string }>>
  );
  console.log("\nremaining templates visible (status=published):");
  for (const r of rows) console.log(`  • ${r.id} ${r.name} ${r.status}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
