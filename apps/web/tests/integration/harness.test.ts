import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, readRevision, seedResume, type TestDb } from "./helpers/test-db";

/**
 * 先证明测试脚手架本身可信。
 *
 * 这一段必须先绿，否则后面所有「事务正确」的结论都建在未经验证的地基上。
 */
describe("集成测试脚手架", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb("harness");
  });

  afterAll(async () => {
    await testDb?.dispose();
  });

  it("迁移把新表建在隔离数据库内，且不碰应用库", async () => {
    const rows = await testDb.client.unsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((row) => row.table_name);
    for (const expected of [
      "resume",
      "resume_mutation",
      "resume_mutation_event",
      "resume_change_set",
      "resume_decision",
    ]) {
      expect(names, `缺少表 ${expected}`).toContain(expected);
    }
    // 确认当前连的确实是隔离库，而不是应用库。
    expect(testDb.databaseName.startsWith("ib_it_")).toBe(true);
    const dbName = await testDb.client.unsafe<{ current_database: string }[]>(
      `SELECT current_database()`,
    );
    expect(dbName[0].current_database).toBe(testDb.databaseName);
  });

  it("resume.revision 默认 0，旧行语义不变", async () => {
    const { resumeId } = await seedResume(testDb);
    expect(await readRevision(testDb, resumeId)).toBe(0);
  });

  it("resume_mutation 的幂等唯一键生效", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    await testDb.db.execute(
      `INSERT INTO "resume_mutation"
        ("id","mutationId","resumeId","userId","requestHash","operationIds","beforeJson","afterJson","revision","versionId","source","actorName")
       VALUES ('m1','dup','${resumeId}','${userId}','h','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,1,'v1','manual','张三')`,
    );
    await expect(
      testDb.db.execute(
        `INSERT INTO "resume_mutation"
          ("id","mutationId","resumeId","userId","requestHash","operationIds","beforeJson","afterJson","revision","versionId","source","actorName")
         VALUES ('m2','dup','${resumeId}','${userId}','h2','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,2,'v2','manual','张三')`,
      ),
    ).rejects.toThrow();
  });

  it("同简历同一个 revision 只能有一条提交（防止两条提交写入同一修订）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    const insert = (id: string, mutationId: string) =>
      testDb.db.execute(
        `INSERT INTO "resume_mutation"
          ("id","mutationId","resumeId","userId","requestHash","operationIds","beforeJson","afterJson","revision","versionId","source","actorName")
         VALUES ('${id}','${mutationId}','${resumeId}','${userId}','h','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,1,'${id}v','manual','张三')`,
      );
    await insert("a", "mut-a");
    await expect(insert("b", "mut-b")).rejects.toThrow();
  });

  it("source 枚举受 CHECK 约束（不接受伪造来源）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    await expect(
      testDb.db.execute(
        `INSERT INTO "resume_mutation"
          ("id","mutationId","resumeId","userId","requestHash","operationIds","beforeJson","afterJson","revision","versionId","source","actorName")
         VALUES ('x','x','${resumeId}','${userId}','h','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,1,'v','pretend-admin','张三')`,
      ),
    ).rejects.toThrow();
  });

  it("dispose 会删掉隔离数据库", async () => {
    const scratch = await createTestDb("dispose-check");
    const name = scratch.databaseName;
    await scratch.dispose();
    const rows = await testDb.client.unsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = '${name}'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("拒绝在缺少 TEST_DATABASE_URL 时运行，且拒绝与 DATABASE_URL 相同", async () => {
    const { resolveTestDatabaseUrl } = await import("./helpers/test-db");
    expect(resolveTestDatabaseUrl({}).ok).toBe(false);
    expect(
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://a", DATABASE_URL: "postgres://a" }).ok,
    ).toBe(false);
    expect(
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://test", DATABASE_URL: "postgres://prod" }).ok,
    ).toBe(true);
  });

  describe("P04 运行存储的迁移", () => {
  it("ai_run / ai_tool_execution / ai_run_event 三张表已建立", async () => {
    const rows = await testDb.client.unsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((row) => row.table_name);
    for (const expected of ["ai_run", "ai_tool_execution", "ai_run_event"]) {
      expect(names, `缺少表 ${expected}`).toContain(expected);
    }
  });

  it("status 枚举受 CHECK 约束（不接受任意状态）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    await expect(
      testDb.db.execute(
        `INSERT INTO "ai_run" ("id","userId","resumeId","requestId","status")
         VALUES ('r-bad','${userId}','${resumeId}','req-bad','pretend-done')`,
      ),
    ).rejects.toThrow();
  });

  it("同一用户同一 requestId 只能有一个 Run（start 幂等）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    const insert = (id: string) =>
      testDb.db.execute(
        `INSERT INTO "ai_run" ("id","userId","resumeId","requestId")
         VALUES ('${id}','${userId}','${resumeId}','req-dup')`,
      );
    await insert("run-a");
    await expect(insert("run-b")).rejects.toThrow();
  });

  it("同一 Run 内 sequence 唯一（跨实例顺序由数据库保证）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    await testDb.db.execute(
      `INSERT INTO "ai_run" ("id","userId","resumeId","requestId") VALUES ('run-seq','${userId}','${resumeId}','req-seq')`,
    );
    const insertEvent = (eventId: string, sequence: number) =>
      testDb.db.execute(
        `INSERT INTO "ai_run_event" ("eventId","runId","attemptId","sequence","type","payload")
         VALUES ('${eventId}','run-seq','att-1',${sequence},'text.delta','{}'::jsonb)`,
      );
    await insertEvent("e1", 1);
    await expect(insertEvent("e2", 1)).rejects.toThrow();
  });

  it("工具账本按 (runId, attemptId, toolCallId) 唯一（重试不得重复记账）", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    await testDb.db.execute(
      `INSERT INTO "ai_run" ("id","userId","resumeId","requestId") VALUES ('run-tool','${userId}','${resumeId}','req-tool')`,
    );
    const insertTool = (id: string) =>
      testDb.db.execute(
        `INSERT INTO "ai_tool_execution" ("id","runId","attemptId","toolCallId","toolName","inputHash","status")
         VALUES ('${id}','run-tool','att-1','call-1','readResume','h','succeeded')`,
      );
    await insertTool("t1");
    await expect(insertTool("t2")).rejects.toThrow();
  });

  it("outbox 投影去重：同一个 sourceEventId 只投影一次", async () => {
    const { userId, resumeId } = await seedResume(testDb);
    await testDb.db.execute(
      `INSERT INTO "ai_run" ("id","userId","resumeId","requestId") VALUES ('run-proj','${userId}','${resumeId}','req-proj')`,
    );
    const project = (eventId: string, sequence: number) =>
      testDb.db.execute(
        `INSERT INTO "ai_run_event" ("eventId","runId","attemptId","sequence","type","payload","sourceEventId")
         VALUES ('${eventId}','run-proj','att-1',${sequence},'mutation.committed','{}'::jsonb,'src-1')`,
      );
    await project("pe1", 1);
    await expect(project("pe2", 2)).rejects.toThrow();
  });
  });
});
