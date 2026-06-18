# Deploy DB Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded production deployment migration step for the Web app.

**Architecture:** A small Web package script checks whether the deployment is Vercel production, then invokes Drizzle's postgres-js migrator against `apps/web/db/migrations`. Vercel runs this script before `@intro-builder/web build`; preview/local runs skip by default.

**Tech Stack:** Next.js 16, pnpm workspace scripts, Drizzle ORM migrator, postgres-js, Vitest.

---

### Task 1: Add Deploy Migration Guard And Tests

**Files:**
- Create: `apps/web/scripts/migrate-on-deploy.ts`
- Create: `apps/web/tests/unit/deploy-migrations.test.ts`
- Modify: `apps/web/package.json`
- Modify: `vercel.json`

- [x] **Step 1: Write failing tests**

Create `apps/web/tests/unit/deploy-migrations.test.ts` with tests that:

```ts
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
```

- [x] **Step 2: Verify the tests fail**

Run: `pnpm --filter @intro-builder/web test -- deploy-migrations.test.ts`

Expected: FAIL because `scripts/migrate-on-deploy.ts` and the package script do
not exist yet.

- [x] **Step 3: Implement the script and wiring**

Create `apps/web/scripts/migrate-on-deploy.ts`, add
`"migrate:on-deploy": "tsx scripts/migrate-on-deploy.ts"` to
`apps/web/package.json`, and update `vercel.json` build command to run the
migration script before build.

- [x] **Step 4: Verify tests pass**

Run: `pnpm --filter @intro-builder/web test -- deploy-migrations.test.ts`

Expected: PASS.

- [x] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0. Existing lint warnings may remain if unrelated
to this change.

Completed on 2026-06-18:

- `pnpm --filter @intro-builder/web test -- deploy-migrations.test.ts`: passed.
- `pnpm test`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: exited 0 with 12 existing warnings unrelated to this change.
- `pnpm build`: passed.
- Smoke: `VERCEL_ENV=preview pnpm --filter @intro-builder/web migrate:on-deploy`
  skipped without touching the database.
- Smoke: `VERCEL_ENV=production` with no database URL failed, confirming
  production migration cannot silently proceed without database credentials.
