import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const users = (await sql`SELECT id, email, name FROM users LIMIT 5`) as Array<{ id: string; email: string; name: string | null }>;
  console.log(`users: ${users.length}`);
  for (const u of users) console.log(`  • ${u.id}  ${u.email}  ${u.name ?? ""}`);
  const resumes = (await sql`SELECT id, "userId", title FROM resumes LIMIT 5`) as Array<{ id: string; userId: string; title: string | null }>;
  console.log(`resumes: ${resumes.length}`);
  for (const r of resumes) console.log(`  • ${r.id}  user=${r.userId}  ${r.title ?? ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
