import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

describe("db migrations", () => {
  it("registers every SQL migration in the Drizzle journal", () => {
    const migrationsDir = join(process.cwd(), "db/migrations");
    const migrationTags = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => basename(file, ".sql"))
      .sort();
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, "meta/_journal.json"), "utf-8"),
    ) as { entries: Array<{ tag: string }> };
    const journalTags = new Set(journal.entries.map((entry) => entry.tag));

    expect(migrationTags).not.toHaveLength(0);
    expect(migrationTags.filter((tag) => !journalTags.has(tag))).toEqual([]);
  });

  it("keeps legacy template migrations safe for partially migrated databases", () => {
    const migrationsDir = join(process.cwd(), "db/migrations");
    const legacyTemplateMigrations = [
      "0005_chunky_slipstream.sql",
      "0006_perfect_robbie_robertson.sql",
      "0007_add_section_icons_drop_layout.sql",
      "0008_assets_to_banner_image_url.sql",
    ];

    for (const file of legacyTemplateMigrations) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");

      expect(sql, `${file} must not add template columns without IF NOT EXISTS`).not.toMatch(
        /ALTER TABLE "templates" ADD COLUMN(?! IF NOT EXISTS)/,
      );
      expect(sql, `${file} must not drop template columns without IF EXISTS`).not.toMatch(
        /ALTER TABLE "templates" DROP COLUMN(?! IF EXISTS)/,
      );
      for (const legacyColumn of ["source", "layout"]) {
        const alteringLegacyColumn = sql.includes(
          `ALTER TABLE "templates" ALTER COLUMN "${legacyColumn}"`,
        );
        if (!alteringLegacyColumn) continue;

        expect(
          sql,
          `${file} must guard ALTER COLUMN "${legacyColumn}" with information_schema`,
        ).toContain(`column_name = '${legacyColumn}'`);
      }
      expect(sql, `${file} must not directly read templates.layout when it may be absent`).not.toMatch(
        /\blayout->/,
      );
    }
  });
});
