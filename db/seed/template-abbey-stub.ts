/**
 * Foundation seed: inserts a single uploaded template that uses only existing
 * variants (professional). Renders identically to the built-in professional
 * template, but goes through the UploadedLayout dispatch path. Lets us verify
 * the entire DB-template pipeline end-to-end before any AI / decoration
 * features land.
 *
 * Run with: pnpm tsx db/seed/template-abbey-stub.ts
 * Requires DATABASE_URL in env (real DB; not the build-time placeholder).
 */
import { db } from "@/db";
import { templates } from "@/db/schema";

async function main() {
  await db
    .insert(templates)
    .values({
      id: "abbey-stub",
      name: "Abbey Stub（验证用）",
      description: "Foundation 验证模板，用现有 professional variant 渲染",
      thumbnailUrl: null,
      source: "uploaded",
      decoration: null,
      layout: {
        headerVariant: "professional",
        sectionTitleVariant: "professional",
        itemHeaderVariant: "professional",
        theme: { primaryColor: "#137880" },
        sectionIcons: {
          experience: "Briefcase",
          education: "GraduationCap",
          projects: "FolderKanban",
          skills: "Sparkles",
        },
      },
      status: "published",
      createdBy: "seed-script",
    })
    .onConflictDoNothing();
  console.log("Seeded abbey-stub");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
