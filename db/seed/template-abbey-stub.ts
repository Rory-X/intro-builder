/**
 * Foundation seed: inserts a single uploaded template that uses only existing
 * variants (professional). Renders identically to the built-in professional
 * template, but goes through the UploadedLayout dispatch path. Lets us verify
 * the entire DB-template pipeline end-to-end before any AI / decoration
 * features land.
 *
 * Run with: pnpm exec tsx --env-file=.env.local db/seed/template-abbey-stub.ts
 * (--env-file is required: db/index.ts reads DATABASE_URL at import time, and
 * `import { config } from "dotenv"; config(...)` runs *after* all imports
 * resolve, so dotenv-in-file is too late to influence the db module.)
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
        frame: { kind: "vertical" },
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
