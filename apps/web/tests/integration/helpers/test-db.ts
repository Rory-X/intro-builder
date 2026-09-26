import { createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

import * as schema from "@/db/schema";

/**
 * 隔离测试库的获取与防护（P02）。
 *
 * 三条硬规则，每一条都对应一种真实事故：
 *
 * 1. **只接受 `TEST_DATABASE_URL`**。绝不回退到 `DATABASE_URL` —— 否则在没配测试库的
 *    机器上会直接对应用库跑破坏性用例。
 * 2. **拒绝与 `DATABASE_URL` 相同**的连接串。凭据写错是最容易发生的事故。
 * 3. **每个测试文件一个独立数据库**（不是独立 schema），用完 DROP。
 *
 * 为什么是独立数据库而不是独立 schema：迁移 SQL 里存在硬编码的跨表外键
 * （`REFERENCES "public"."user"`，由 Drizzle 生成）。在隔离 schema 下这些引用仍指向
 * `public`，基础表根本建不起来 —— 实测首个迁移直接失败，后续全部级联报
 * `relation "user" does not exist`。独立数据库让 `public` 就是该库自己的 public，
 * 与生产结构完全一致，不需要改写历史迁移文件。
 */

export type TestDb = {
  client: postgres.Sql;
  db: ReturnType<typeof drizzle<typeof schema>>;
  databaseName: string;
  /** 直接执行原始 SQL（用于迁移与故障注入）。 */
  exec: (statement: string) => Promise<unknown>;
  /** 起一个独立连接（用于「第二个并发请求」这类场景）。 */
  newIsolatedClient: () => { client: postgres.Sql; db: ReturnType<typeof drizzle<typeof schema>> };
  dispose: () => Promise<void>;
};

const REQUIRED_ENV = "TEST_DATABASE_URL";

/** 测试库 URL 解析 + 防护。导出以便单测直接覆盖这些规则。 */
export function resolveTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): { ok: true; url: string } | { ok: false; reason: string } {
  const raw = env[REQUIRED_ENV]?.trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        `未设置 ${REQUIRED_ENV}。集成测试需要独立的 PostgreSQL 测试库；` +
        `不会回退到 DATABASE_URL。`,
    };
  }
  const production = env.DATABASE_URL?.trim();
  if (production && production === raw) {
    return {
      ok: false,
      reason: `${REQUIRED_ENV} 不能与 DATABASE_URL 相同 —— 拒绝在应用库上运行破坏性用例。`,
    };
  }
  return { ok: true, url: raw };
}

/** 库名：固定前缀 + 内容哈希，不同测试文件之间不撞名，并可在 pg_database 里辨认。 */
export function testDatabaseName(label: string): string {
  const digest = createHash("sha256").update(`${label}:${process.pid}`).digest("hex").slice(0, 12);
  return `ib_it_${digest}`;
}

/** 把 URL 的库名换成另一个（保留主机/端口/凭据）。 */
export function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/**
 * 应用全部迁移文件。
 *
 * 刻意不复用 drizzle 的 `migrate()`：它把已应用记录写在
 * `drizzle.__drizzle_migrations` 里，而每个测试库都是全新建的，直接按文件名顺序
 * 执行 DDL 更简单、更可观察（失败时能精确指出是哪个文件）。
 */
async function applyMigrations(client: postgres.Sql): Promise<void> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const dir = join(process.cwd(), "db/migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf-8");
    try {
      await client.unsafe(raw);
    } catch (error) {
      // 明确指出失败文件，否则只会看到一句含糊的 Postgres 错误。
      throw new Error(
        `[integration] 迁移 ${file} 执行失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** 建立隔离库。未配置或配置不安全时抛错 —— 明确失败，而不是静默跳过。 */
export async function createTestDb(label: string): Promise<TestDb> {
  const resolved = resolveTestDatabaseUrl();
  if (!resolved.ok) {
    throw new Error(`[integration] ${resolved.reason}`);
  }

  const databaseName = testDatabaseName(label);

  // 先用管理连接建库（连到 TEST_DATABASE_URL 指向的库本身）。
  const admin = postgres(resolved.url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const connect = (max: number) =>
    postgres(withDatabaseName(resolved.url, databaseName), { max, onnotice: () => {} });

  const client = connect(8);
  await applyMigrations(client);

  const db = drizzle(client, { schema });
  const newIsolatedClient = () => {
    const extra = connect(2);
    return { client: extra, db: drizzle(extra, { schema }) };
  };

  const dispose = async () => {
    try {
      await client.end({ timeout: 5 });
    } finally {
      const cleanup = postgres(resolved.url, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } finally {
        await cleanup.end({ timeout: 5 });
      }
    }
  };

  return { client, db, databaseName, exec: (s) => client.unsafe(s), newIsolatedClient, dispose };
}

/** 插入一个用户 + 一份简历，返回 ID。所有用例的起点。 */
export async function seedResume(
  testDb: TestDb,
  options: { content?: unknown; title?: string; templateId?: string; revision?: number } = {},
): Promise<{ userId: string; resumeId: string }> {
  const userId = `u_${crypto.randomUUID()}`;
  const resumeId = `r_${crypto.randomUUID()}`;
  const content = options.content ?? {
    basics: { name: "张三", status: "", title: "", email: "", phone: "", location: "", website: "", summary: "", photo: "" },
    education: [],
    experience: [],
    projects: [],
    research: [],
    skills: { type: "doc", content: [] },
    summary: { type: "doc", content: [] },
    awards: { type: "doc", content: [] },
    portfolio: { type: "doc", content: [] },
    custom: [],
    sectionOrder: ["basics"],
  };

  await testDb.db.execute(sql`
    INSERT INTO "user" (id, email) VALUES (${userId}, ${`${userId}@example.com`})
  `);
  await testDb.db.execute(sql`
    INSERT INTO "resume" (id, "userId", title, "templateId", content, revision)
    VALUES (${resumeId}, ${userId}, ${options.title ?? "测试简历"}, ${options.templateId ?? "classic"},
            ${JSON.stringify(content)}::jsonb, ${options.revision ?? 0})
  `);

  return { userId, resumeId };
}

/** 读取当前 revision 与正文（用于断言「正文回滚」）。 */
export async function readResumeState(
  testDb: TestDb,
  resumeId: string,
): Promise<{ revision: number; content: Record<string, unknown> }> {
  const result = await testDb.client.unsafe<{ revision: number; content: Record<string, unknown> }[]>(
    `SELECT revision, content FROM "resume" WHERE id = $1`,
    [resumeId],
  );
  const row = result[0];
  if (!row) throw new Error(`找不到简历 ${resumeId}`);
  return { revision: row.revision, content: row.content };
}

/** 读取 revision（常用断言的简写）。 */
export async function readRevision(testDb: TestDb, resumeId: string): Promise<number> {
  return (await readResumeState(testDb, resumeId)).revision;
}
