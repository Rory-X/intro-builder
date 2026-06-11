import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  for (let i = 1; i <= 5; i++) {
    try {
      const rows = (await sql`
        UPDATE resume
        SET "templateId" = 'crimson-banner', "updatedAt" = now()
        WHERE id = '856a0f5c-4ee1-49e2-8df9-951d3056ae04'
        RETURNING id, "templateId", title
      `) as Array<{ id: string; templateId: string; title: string }>;
      console.log("✓ updated:", rows[0]);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i === 5 || !/fetch failed|ECONNRESET|TLS|handshake/i.test(msg)) throw e;
      console.warn(`attempt ${i} transient, retry in ${500 * 2 ** (i - 1)}ms`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
