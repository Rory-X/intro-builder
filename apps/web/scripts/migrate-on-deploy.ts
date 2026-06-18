import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

type DeployMigrationEnv = {
  [key: string]: string | undefined;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
  VERCEL_ENV?: string;
};

const scriptPath = fileURLToPath(import.meta.url);
const packageDir = resolve(dirname(scriptPath), "..");

export function shouldRunDeployMigrations(env: DeployMigrationEnv): boolean {
  return env.VERCEL_ENV === "production";
}

export function describeDeployMigrationDecision(env: DeployMigrationEnv): string {
  if (env.VERCEL_ENV !== "production") {
    return `skipped: VERCEL_ENV is ${env.VERCEL_ENV ?? "unset"}, not production`;
  }
  return "run";
}

export function resolveMigrationDatabaseUrl(env: DeployMigrationEnv): string | null {
  const unpooledUrl = env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooledUrl) return unpooledUrl;
  const databaseUrl = env.DATABASE_URL?.trim();
  return databaseUrl || null;
}

export function loadDeployMigrationEnvFiles(baseDir = packageDir): void {
  config({ path: resolve(baseDir, ".env.local"), quiet: true });
  config({ path: resolve(baseDir, ".env"), quiet: true });
}

export async function runDeployMigrations({
  env = process.env,
  migrationsFolder = resolve(packageDir, "db/migrations"),
}: {
  env?: DeployMigrationEnv;
  migrationsFolder?: string;
} = {}): Promise<void> {
  const decision = describeDeployMigrationDecision(env);
  if (!shouldRunDeployMigrations(env)) {
    console.log(`[migrate:on-deploy] ${decision}`);
    return;
  }

  const databaseUrl = resolveMigrationDatabaseUrl(env);
  if (!databaseUrl) {
    throw new Error(
      "[migrate:on-deploy] DATABASE_URL_UNPOOLED or DATABASE_URL must be set for production deployment migrations.",
    );
  }

  console.log("[migrate:on-deploy] applying Drizzle migrations");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
  console.log("[migrate:on-deploy] migrations complete");
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  loadDeployMigrationEnvFiles();
  runDeployMigrations().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
