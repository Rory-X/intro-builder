# Deploy DB Migrations Design

## Goal

Production Web deployments should synchronize Drizzle migrations before the
Next.js build so new tables, such as floating Agent session tables, exist before
new code starts serving traffic.

## Decisions

- Run deployment migrations when `VERCEL_ENV=production`.
- Skip migrations for preview deploys, local builds, and CI builds.
- Prefer `DATABASE_URL_UNPOOLED` for migrations. Fall back to `DATABASE_URL`
  only when an unpooled URL is unavailable.
- Fail the production build if no database URL is
  present. Silent success would ship code against an unknown schema state.
- Use Drizzle's migrator against `apps/web/db/migrations`; no custom table
  creation logic belongs in the deployment script.

## Non-Goals

- Do not run migrations from the Agent or PartyKit deployment workflows.
- Do not migrate preview databases automatically.
- Do not add destructive migration automation or rollback behavior in this
  slice.

## Success Criteria

- Vercel production build command runs a migration gate before the Web build.
- Local and preview builds log a clear skip message.
- Unit tests cover the production gate, DB URL preference, package script, and
  Vercel build command wiring.
