import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeDeployMigrationDecision,
  resolveMigrationDatabaseUrl,
  shouldRunDeployMigrations,
} from "../../scripts/migrate-on-deploy";

describe("deploy migrations", () => {
  it("runs only for production deployments", () => {
    expect(
      shouldRunDeployMigrations({
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(
      shouldRunDeployMigrations({
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      shouldRunDeployMigrations({
        VERCEL_ENV: undefined,
      }),
    ).toBe(false);
  });

  it("prefers the unpooled migration database URL", () => {
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_URL_UNPOOLED: "postgres://unpooled",
        DATABASE_URL: "postgres://pooled",
      }),
    ).toBe("postgres://unpooled");
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_URL: "postgres://pooled",
      }),
    ).toBe("postgres://pooled");
  });

  it("explains skipped deploy migrations", () => {
    expect(describeDeployMigrationDecision({ VERCEL_ENV: "preview" })).toBe(
      "skipped: VERCEL_ENV is preview, not production",
    );
  });

  it("wires deploy migrations into the Web package and Vercel build", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf-8"),
    ) as { scripts: Record<string, string> };
    const vercelJson = JSON.parse(
      readFileSync(join(process.cwd(), "../../vercel.json"), "utf-8"),
    ) as { buildCommand: string };

    expect(packageJson.scripts["migrate:on-deploy"]).toBe(
      "tsx scripts/migrate-on-deploy.ts",
    );
    expect(vercelJson.buildCommand).toBe(
      "pnpm --filter @intro-builder/web migrate:on-deploy && pnpm --filter @intro-builder/web build",
    );
  });
});
