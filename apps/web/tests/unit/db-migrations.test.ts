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
});
