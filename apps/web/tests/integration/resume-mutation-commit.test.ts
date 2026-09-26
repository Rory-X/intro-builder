import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { resumes } from "@/db/schema";
import {
  hashTargetValue,
  type SemanticOperation,
} from "@intro-builder/shared/schemas";
import { commitResumeMutation, type CommitPrincipal } from "@/lib/resume-mutations/commit";
import { createTestDb, readResumeState, seedResume, type TestDb } from "./helpers/test-db";

/**
 * 原子提交、幂等与并发的**真实数据库**验证（P02）。
 *
 * 这些断言无法用 mock 证明：CAS 是否真的只有一方成功、失败注入后正文是否真的回滚、
 * 唯一约束是否真的拦住重复，都必须在真实 PostgreSQL 上跑。
 */

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function experienceContent() {
  return {
    basics: { name: "张三", status: "", title: "", email: "", phone: "", location: "", website: "", summary: "", photo: "" },
    education: [],
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
      { id: "exp-b", company: "乙公司", title: "后端", start: "2021", end: "2022", location: "", content: doc("做乙") },
    ],
    projects: [],
    research: [],
    skills: doc("技能"),
    summary: doc(""),
    awards: doc(""),
    portfolio: doc(""),
    custom: [],
    sectionOrder: ["basics", "experience", "skills"],
  };
}

function setCompany(id: string, value: string, expected: string): SemanticOperation {
  return {
    id: `op-${id}-${value}`,
    kind: "set_field",
    target: { section: "experience", itemId: id, field: "company" },
    condition: { expectedValueHash: hashTargetValue(expected) },
    value,
  };
}

/** 生产依赖，但把 SQL 交给测试库执行。 */
function depsFor(testDb: TestDb) {
  return {
    execute: (statement: Parameters<TestDb["exec"]>[0]) => testDb.db.execute(statement as never),
  };
}

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb("commit");
});

afterAll(async () => {
  await testDb?.dispose();
});

async function scenario() {
  const { userId, resumeId } = await seedResume(testDb, { content: experienceContent() });
  const principal: CommitPrincipal = {
    userId,
    actorName: "张三",
    source: "agent",
  };
  return { userId, resumeId, principal };
}

describe("提交：成功路径", () => {
  it("正文、revision、修订快照、回执、outbox 一次落盘", async () => {
    const { resumeId, principal } = await scenario();

    const outcome = await commitResumeMutation(
      principal,
      {
        mutationId: "m-1",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-a", "甲公司（改）", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );

    expect(outcome.status).toBe("committed");
    if (outcome.status !== "committed") return;
    expect(outcome.result.revision).toBe(1);

    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(1);
    const experience = (state.content as { experience: Array<{ id: string; company: string }> }).experience;
    expect(experience.find((e) => e.id === "exp-a")?.company).toBe("甲公司（改）");
    expect(experience.find((e) => e.id === "exp-b")?.company).toBe("乙公司");

    // 修订快照保存的是**提交后**的内容。
    const versions = await testDb.client.unsafe<{ revision: number; content: unknown; source: string }[]>(
      `SELECT revision, content, source FROM "resume_version" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].revision).toBe(1);
    expect(versions[0].source).toBe("agent");
    const snapshot = versions[0].content as { experience: Array<{ id: string; company: string }> };
    expect(snapshot.experience.find((e) => e.id === "exp-a")?.company).toBe("甲公司（改）");

    // 回执带真实前后值。
    const receipts = await testDb.client.unsafe<{ beforeJson: unknown; afterJson: unknown }[]>(
      `SELECT "beforeJson", "afterJson" FROM "resume_mutation" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0].beforeJson).toEqual(["甲公司"]);
    expect(receipts[0].afterJson).toEqual(["甲公司（改）"]);

    // outbox 事件与正文同一条 SQL 写入。
    const events = await testDb.client.unsafe<{ type: string }[]>(
      `SELECT type FROM "resume_mutation_event" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("mutation.committed");
  });

  it("行级字段（标题/模板）在提交层更新，且不影响 content", async () => {
    const { resumeId, principal } = await scenario();
    const outcome = await commitResumeMutation(
      principal,
      {
        mutationId: "m-title",
        resumeId,
        expectedRevision: 0,
        operations: [{ id: "op-t", kind: "set_title", before: "测试简历", after: "前端简历" }],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(outcome.status).toBe("committed");

    const rows = await testDb.db.select({ title: resumes.title, content: resumes.content })
      .from(resumes).where(eq(resumes.id, resumeId));
    expect(rows[0].title).toBe("前端简历");
    // content 里不应出现 title。
    expect((rows[0].content as unknown as Record<string, unknown>).title).toBeUndefined();
  });
});

describe("提交：幂等", () => {
  it("同 mutationId 同 payload 返回原回执，不产生第二个修订", async () => {
    const { resumeId, principal } = await scenario();
    const command = {
      mutationId: "m-idem",
      resumeId,
      expectedRevision: 0,
      operations: [setCompany("exp-a", "甲公司（改）", "甲公司")],
    };

    const first = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });
    const second = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });

    expect(first.status).toBe("committed");
    expect(second.status).toBe("committed");
    if (first.status !== "committed" || second.status !== "committed") return;
    // 关键：重放拿到的是**同一个** revision 与 versionId。
    expect(second.result.revision).toBe(first.result.revision);
    expect(second.result.versionId).toBe(first.result.versionId);

    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(1);
    const versions = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_version" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(versions[0].n).toBe("1");
  });

  it("同 mutationId 不同 payload 被拒绝", async () => {
    const { resumeId, principal } = await scenario();
    await commitResumeMutation(
      principal,
      {
        mutationId: "m-reuse",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-a", "甲公司（改）", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );

    const reused = await commitResumeMutation(
      principal,
      {
        mutationId: "m-reuse",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-a", "完全不同的内容", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(reused.status).toBe("rejected");
    if (reused.status !== "rejected") return;
    expect(reused.result.code).toContain("idempotency_key_reuse");

    // 正文仍是第一次的结果。
    const state = await readResumeState(testDb, resumeId);
    const experience = (state.content as { experience: Array<{ id: string; company: string }> }).experience;
    expect(experience.find((e) => e.id === "exp-a")?.company).toBe("甲公司（改）");
  });

  it("保存成功但响应丢失：重试同 ID 返回原回执，没有第二版本", async () => {
    const { resumeId, principal } = await scenario();
    const command = {
      mutationId: "m-lost-response",
      resumeId,
      expectedRevision: 0,
      operations: [setCompany("exp-b", "乙公司（改）", "乙公司")],
    };
    const committed = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });
    expect(committed.status).toBe("committed");

    // 模拟客户端超时后重试：服务端已经提交，客户端以为失败。
    const retried = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });
    if (retried.status !== "committed" || committed.status !== "committed") throw new Error("expected committed");
    expect(retried.result.revision).toBe(committed.result.revision);

    const count = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_mutation" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(count[0].n).toBe("1");
  });
});

describe("提交：revision 冲突（并发）", () => {
  it("两个请求同一 expectedRevision，只有一个成功，另一个保留原输入并报冲突", async () => {
    const { resumeId, principal } = await scenario();

    // 真正的并发：两个请求同时出发，而不是先后调用。
    const [a, b] = await Promise.all([
      commitResumeMutation(
        principal,
        {
          mutationId: "m-conc-a",
          resumeId,
          expectedRevision: 0,
          operations: [setCompany("exp-a", "来自A", "甲公司")],
        },
        { deps: depsFor(testDb), newItemId: () => "itm_test" },
      ),
      commitResumeMutation(
        principal,
        {
          mutationId: "m-conc-b",
          resumeId,
          expectedRevision: 0,
          operations: [setCompany("exp-b", "来自B", "乙公司")],
        },
        { deps: depsFor(testDb), newItemId: () => "itm_test" },
      ),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["committed", "conflict"]);

    const conflict = a.status === "conflict" ? a : b.status === "conflict" ? b : null;
    expect(conflict).not.toBeNull();

    // 只推进了一个 revision，且只有一条提交记录。
    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(1);
    const count = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_mutation" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(count[0].n).toBe("1");

    // 失败方的内容没有被写入。
    const experience = (state.content as { experience: Array<{ id: string; company: string }> }).experience;
    const aWon = a.status === "committed";
    expect(experience.find((e) => e.id === (aWon ? "exp-a" : "exp-b"))?.company).toBe(aWon ? "来自A" : "来自B");
    expect(experience.find((e) => e.id === (aWon ? "exp-b" : "exp-a"))?.company).toBe(aWon ? "乙公司" : "甲公司");
  });

  it("旧 revision 的提交被拒绝，并返回当前真实 revision", async () => {
    const { resumeId, principal } = await scenario();
    await commitResumeMutation(
      principal,
      {
        mutationId: "m-1",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-a", "第一步", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );

    const stale = await commitResumeMutation(
      principal,
      {
        mutationId: "m-2",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-b", "第二步", "乙公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(stale.result.currentRevision).toBe(1);
  });

  it("拒绝越过 revision 的写入（expectedRevision 落后于库）", async () => {
    const { resumeId, principal } = await scenario();
    // 直接把库里的 revision 推进，模拟另一个 writer 已经提交过。
    await testDb.client.unsafe(`UPDATE "resume" SET revision = 5 WHERE id = $1`, [resumeId]);

    const outcome = await commitResumeMutation(
      principal,
      {
        mutationId: "m-behind",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-a", "x", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(outcome.status).toBe("conflict");
    if (outcome.status !== "conflict") return;
    expect(outcome.result.currentRevision).toBe(5);
  });
});

describe("提交：原子失败（故障注入）", () => {
  it("修订快照插入失败时，正文完全回滚，且没有残留成功记录", async () => {
    const { resumeId, principal } = await scenario();

    // 注入：让 resume_version 插入必然失败（违反 NOT NULL）。
    await testDb.client.unsafe(`ALTER TABLE "resume_version" ALTER COLUMN "actorName" SET NOT NULL`);
    await testDb.client.unsafe(
      `CREATE OR REPLACE FUNCTION fail_version() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'injected failure: version insert'; END;
       $$ LANGUAGE plpgsql`,
    );
    await testDb.client.unsafe(
      `CREATE TRIGGER t_fail_version BEFORE INSERT ON "resume_version"
       FOR EACH ROW EXECUTE FUNCTION fail_version()`,
    );

    await expect(
      commitResumeMutation(
        principal,
        {
          mutationId: "m-fail-version",
          resumeId,
          expectedRevision: 0,
          operations: [setCompany("exp-a", "不应落盘", "甲公司")],
        },
        { deps: depsFor(testDb), newItemId: () => "itm_test" },
      ),
    ).rejects.toThrow();

    // 正文必须保持原样：不能出现「改了但没留痕」。
    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(0);
    const experience = (state.content as { experience: Array<{ id: string; company: string }> }).experience;
    expect(experience.find((e) => e.id === "exp-a")?.company).toBe("甲公司");

    const mutations = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_mutation" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(mutations[0].n).toBe("0");
    const events = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_mutation_event" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(events[0].n).toBe("0");

    await testDb.client.unsafe(
      `DROP TRIGGER t_fail_version ON "resume_version"`);
    await testDb.client.unsafe(
      `DROP FUNCTION fail_version()`);
  });

  it("outbox 事件插入失败时，正文与回执一起回滚", async () => {
    const { resumeId, principal } = await scenario();
    await testDb.client.unsafe(
      `CREATE OR REPLACE FUNCTION fail_event() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'injected failure: event insert'; END;
       $$ LANGUAGE plpgsql`,
    );
    await testDb.client.unsafe(
      `CREATE TRIGGER t_fail_event BEFORE INSERT ON "resume_mutation_event"
       FOR EACH ROW EXECUTE FUNCTION fail_event()`,
    );

    await expect(
      commitResumeMutation(
        principal,
        {
          mutationId: "m-fail-event",
          resumeId,
          expectedRevision: 0,
          operations: [setCompany("exp-a", "不应落盘", "甲公司")],
        },
        { deps: depsFor(testDb), newItemId: () => "itm_test" },
      ),
    ).rejects.toThrow();

    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(0);
    const mutations = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_mutation" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(mutations[0].n).toBe("0");

    await testDb.client.unsafe(
      `DROP TRIGGER t_fail_event ON "resume_mutation_event"`);
    await testDb.client.unsafe(
      `DROP FUNCTION fail_event()`);
  });

  it("零变更不生成空修订", async () => {
    const { resumeId, principal } = await scenario();
    const outcome = await commitResumeMutation(
      principal,
      {
        mutationId: "m-noop",
        resumeId,
        expectedRevision: 0,
        // 把「甲公司」写成「甲公司」——原样无变化。
        operations: [setCompany("exp-a", "甲公司", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(outcome.status).toBe("no_change");
    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(0);
    const versions = await testDb.client.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "resume_version" WHERE "resumeId" = $1`,
      [resumeId],
    );
    expect(versions[0].n).toBe("0");
  });
});

describe("提交：越权与非法输入", () => {
  it("提交必须携带 revision（缺失即拒绝）", async () => {
    const { resumeId, principal } = await scenario();
    const outcome = await commitResumeMutation(
      principal,
      {
        mutationId: "m-no-rev",
        resumeId,
        operations: [setCompany("exp-a", "x", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(outcome.status).toBe("rejected");
  });

  it("越权字段被拒绝（不接受 itemId 之外的身份改写）", async () => {
    const { resumeId, principal } = await scenario();
    const outcome = await commitResumeMutation(
      principal,
      {
        mutationId: "m-bad-field",
        resumeId,
        expectedRevision: 0,
        operations: [
          {
            id: "op-bad",
            kind: "set_field",
            target: { section: "experience", itemId: "exp-a", field: "ownerId" },
            condition: { expectedValueHash: hashTargetValue("甲公司") },
            value: "别的用户",
          },
        ],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(outcome.status).toBe("rejected");
    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(0);
  });

  it("用户的简历才可写：用别的 userId 提交时拒绝", async () => {
    const { resumeId } = await scenario();
    const outcome = await commitResumeMutation(
      { userId: "someone-else", actorName: "别人", source: "manual" },
      {
        mutationId: "m-other-user",
        resumeId,
        expectedRevision: 0,
        operations: [setCompany("exp-a", "x", "甲公司")],
      },
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );
    expect(outcome.status).toBe("rejected");
    const state = await readResumeState(testDb, resumeId);
    expect(state.revision).toBe(0);
  });
});

describe("【独立复核发现】回执查询必须核验归属", () => {
  it("越权者凭 resumeId + mutationId 读不到他人回执", async () => {
    /*
     * 真实缺陷：`lookupReceipt` 在带 userId 的 `readBase` **之前**执行，
     * 命中即返回 `committed` 连同真实 revision / versionId / eventId / committedAt。
     * 越权者只需知道 resumeId 与 mutationId 就能读到他人回执。
     * 契约 §3 要求这种情况返回 not_found。
     */
    const { resumeId, principal } = await scenario();
    const command = {
      mutationId: "m-owner-only",
      resumeId,
      expectedRevision: 0,
      operations: [setCompany("exp-a", "甲公司（改）", "甲公司")],
    };
    const owner = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });
    expect(owner.status).toBe("committed");

    // 攻击者：同一个 resumeId + mutationId + payload，但 userId 不同。
    const attacker = await commitResumeMutation(
      { userId: "ATTACKER", actorName: "攻击者", source: "manual" },
      command,
      { deps: depsFor(testDb), newItemId: () => "itm_test" },
    );

    // 必须拒绝，且**不得**回传任何回执字段。
    expect(attacker.status).toBe("rejected");
    if (attacker.status !== "rejected") return;
    expect(attacker.result.code).toContain("not_found");
    expect(JSON.stringify(attacker.result)).not.toContain("m-owner-only");
  });

  it("归属正确的重试仍能拿到原回执（幂等未被破坏）", async () => {
    const { resumeId, principal } = await scenario();
    const command = {
      mutationId: "m-same-owner",
      resumeId,
      expectedRevision: 0,
      operations: [setCompany("exp-b", "乙公司（改）", "乙公司")],
    };
    const first = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });
    const retry = await commitResumeMutation(principal, command, {
      deps: depsFor(testDb),
      newItemId: () => "itm_test",
    });
    if (first.status !== "committed" || retry.status !== "committed") throw new Error("expected committed");
    expect(retry.result.revision).toBe(first.result.revision);
    expect(retry.result.versionId).toBe(first.result.versionId);
  });
});
