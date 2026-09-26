import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashTargetValue } from "@intro-builder/shared/schemas";
import type { SQL } from "drizzle-orm";
import { initializeItemIdentities } from "@/lib/resume-mutations/identity";
import { initializeIdentitiesInStore } from "@/lib/resume-mutations/identity-store";
import { commitResumeMutation, type CommitPrincipal } from "@/lib/resume-mutations/commit";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { createTestDb, readResumeState, seedResume, type TestDb } from "./helpers/test-db";

/**
 * 身份初始化 CAS 与条件撤销的真实数据库验证（P02 任务 3、7）。
 */

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** 旧文档：条目没有 ID。 */
function legacyContent() {
  return {
    basics: { name: "张三", status: "", title: "", email: "", phone: "", location: "", website: "", summary: "", photo: "" },
    education: [],
    experience: [
      { company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
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

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb("identity");
});

afterAll(async () => {
  await testDb?.dispose();
});

function depsFor() {
  return {
    execute: (statement: SQL) => testDb.db.execute(statement),
  };
}

/** 与生产等价的 prepare 回调：确定性补齐。 */
function prepareFor(resumeId: string) {
  return (content: unknown) => {
    const result = initializeItemIdentities({
      resumeId,
      content: content as ResumeContent,
    });
    if (!result.ok) return { ok: false as const, reason: result.reason };
    return {
      ok: true as const,
      content: result.content,
      changed: result.changed,
      assignedCount: result.assigned.length,
    };
  };
}

describe("身份初始化 CAS", () => {
  it("把缺失的 ID 原子写入，且**不推进 revision**", async () => {
    const { userId, resumeId } = await seedResume(testDb, { content: legacyContent() });

    const outcome = await initializeIdentitiesInStore(depsFor(), {
      resumeId,
      userId,
      prepare: prepareFor(resumeId),
    });
    expect(outcome.status).toBe("initialized");

    const state = await readResumeState(testDb, resumeId);
    // 身份补齐不算内容变更 —— revision 必须保持 0，否则编辑器会凭空收到冲突。
    expect(state.revision).toBe(0);
    const experience = (state.content as { experience: Array<{ id?: string }> }).experience;
    expect(typeof experience[0].id).toBe("string");
  });

  it("重复调用是幂等的：第二次报告 already_initialized 且 ID 不变", async () => {
    const { userId, resumeId } = await seedResume(testDb, { content: legacyContent() });
    await initializeIdentitiesInStore(depsFor(), { resumeId, userId, prepare: prepareFor(resumeId) });
    const first = await readResumeState(testDb, resumeId);
    const firstId = (first.content as { experience: Array<{ id?: string }> }).experience[0].id;

    const second = await initializeIdentitiesInStore(depsFor(), {
      resumeId,
      userId,
      prepare: prepareFor(resumeId),
    });
    expect(second.status).toBe("already_initialized");

    const after = await readResumeState(testDb, resumeId);
    expect((after.content as { experience: Array<{ id?: string }> }).experience[0].id).toBe(firstId);
  });

  it("两个并发初始化只有一个写入；落败方重读得到**同一套** ID", async () => {
    const { userId, resumeId } = await seedResume(testDb, { content: legacyContent() });

    const [a, b] = await Promise.all([
      initializeIdentitiesInStore(depsFor(), { resumeId, userId, prepare: prepareFor(resumeId) }),
      initializeIdentitiesInStore(depsFor(), { resumeId, userId, prepare: prepareFor(resumeId) }),
    ]);

    const statuses = [a.status, b.status];
    // 内容 CAS 保证只有一个赢家：另一方要么重读后发现「已经初始化」，
    // 要么（极端时序下两次读取都发生在写入前）在 CAS 处失败。二者都不允许
    // 出现两次写入 —— 那会产生两套不同的 ID。
    expect(statuses.filter((s) => s === "initialized").length).toBeLessThanOrEqual(1);

    // 真正的判据：库里只有一条经历、且它的 ID 只出现一次。
    const state = await readResumeState(testDb, resumeId);
    const ids = (state.content as { experience: Array<{ id?: string }> }).experience.map((e) => e.id);
    expect(ids).toHaveLength(1);
    expect(typeof ids[0]).toBe("string");
    // 且 ID 必须等于确定性派生值 —— 说明重算与首次写入得到同一套身份。
    const expected = initializeItemIdentities({
      resumeId,
      content: legacyContent() as unknown as ResumeContent,
    });
    if (!expected.ok) throw new Error("expected ok");
    expect(ids[0]).toBe(expected.content.experience[0].id);
  });

  it("读之后、写之前发生真实编辑时报告 concurrent_edit，不覆盖用户输入", async () => {
    const { userId, resumeId } = await seedResume(testDb, { content: legacyContent() });

    // 真实的交错必须落在「读取」与「CAS 写入」**之间**。提前改库复现不了这个场景
    // （函数会在开头重新读取，看到的已经是新内容），在 prepare 里 fire-and-forget
    // 也不可靠（UPDATE 未必在 CAS 之前完成）。
    // 因此在 execute 这一层做确定性插桩：第一次 execute 是读取，读取完成后
    // 立刻插入另一个 writer 的编辑，然后才轮到 CAS 写入。
    let executed = 0;
    const interleaved = {
      execute: async (statement: SQL) => {
        const result = await testDb.db.execute(statement as never);
        executed += 1;
        if (executed === 1) {
          const current = await readResumeState(testDb, resumeId);
          const edited = {
            ...(current.content as Record<string, unknown>),
            basics: { ...(current.content as { basics: Record<string, unknown> }).basics, name: "李四" },
          };
          await testDb.client.unsafe(
            `UPDATE "resume" SET content = $1::jsonb, revision = 1 WHERE id = $2`,
            [JSON.stringify(edited), resumeId],
          );
        }
        return result;
      },
    };

    const outcome = await initializeIdentitiesInStore(interleaved, {
      resumeId,
      userId,
      prepare: prepareFor(resumeId),
    });

    // 内容 CAS 必须失败：不能把用户刚写入的内容当成「可以安全补齐」的基准覆盖掉。
    expect(outcome.status).toBe("concurrent_edit");

    const after = await readResumeState(testDb, resumeId);
    expect(after.revision).toBe(1);
    expect((after.content as { basics: { name: string } }).basics.name).toBe("李四");
  });

  it("别人无权初始化：userId 不匹配时 not_found", async () => {
    const { resumeId } = await seedResume(testDb, { content: legacyContent() });
    const outcome = await initializeIdentitiesInStore(depsFor(), {
      resumeId,
      userId: "someone-else",
      prepare: prepareFor(resumeId),
    });
    expect(outcome.status).toBe("not_found");
  });

  it("重复 ID 的损坏数据被拒绝，而不是悄悄改名", async () => {
    const corrupted = {
      ...legacyContent(),
      experience: [
        { id: "dup", company: "甲", title: "", start: "", end: "", location: "", content: doc("a") },
        { id: "dup", company: "乙", title: "", start: "", end: "", location: "", content: doc("b") },
      ],
    };
    const { userId, resumeId } = await seedResume(testDb, { content: corrupted });
    await expect(
      initializeIdentitiesInStore(depsFor(), { resumeId, userId, prepare: prepareFor(resumeId) }),
    ).rejects.toThrow(/身份初始化被拒绝/);
  });
});

describe("条件撤销（undo）", () => {
  async function setupIdentified() {
    const { userId, resumeId } = await seedResume(testDb, { content: legacyContent() });
    await initializeIdentitiesInStore(depsFor(), { resumeId, userId, prepare: prepareFor(resumeId) });
    const state = await readResumeState(testDb, resumeId);
    const itemId = (state.content as { experience: Array<{ id: string }> }).experience[0].id;
    const principal: CommitPrincipal = { userId, actorName: "张三", source: "agent" };
    return { userId, resumeId, itemId, principal };
  }

  async function currentCompany(resumeId: string): Promise<string> {
    const state = await readResumeState(testDb, resumeId);
    return (state.content as { experience: Array<{ company: string }> }).experience[0].company;
  }

  it("撤销创建新的 mutation，并关联 undoOf", async () => {
    const { resumeId, itemId, principal } = await setupIdentified();

    const forward = await commitResumeMutation(
      principal,
      {
        mutationId: "m-forward",
        resumeId,
        expectedRevision: 0,
        operations: [
          {
            id: "op-1",
            kind: "set_field",
            target: { section: "experience", itemId, field: "company" },
            condition: { expectedValueHash: hashTargetValue("甲公司") },
            value: "甲甲科技",
          },
        ],
      },
      { deps: depsFor(), newItemId: () => "itm_test" },
    );
    expect(forward.status).toBe("committed");
    expect(await currentCompany(resumeId)).toBe("甲甲科技");

    // 撤销：基于 forward 提交后的值作为前置条件。
    const undo = await commitResumeMutation(
      { ...principal, source: "undo", undoOf: "m-forward" },
      {
        mutationId: "m-undo",
        resumeId,
        expectedRevision: 1,
        operations: [
          {
            id: "op-undo",
            kind: "set_field",
            target: { section: "experience", itemId, field: "company" },
            condition: { expectedValueHash: hashTargetValue("甲甲科技") },
            value: "甲公司",
          },
        ],
      },
      { deps: depsFor(), newItemId: () => "itm_test2" },
    );
    expect(undo.status).toBe("committed");
    expect(await currentCompany(resumeId)).toBe("甲公司");

    const rows = await testDb.client.unsafe<{ undoOf: string | null }[]>(
      `SELECT "undoOf" FROM "resume_mutation" WHERE "mutationId" = 'm-undo'`,
    );
    expect(rows[0].undoOf).toBe("m-forward");
  });

  it("撤销前同字段被手改时冲突，不覆盖用户后来的输入", async () => {
    const { resumeId, itemId, principal } = await setupIdentified();

    await commitResumeMutation(
      principal,
      {
        mutationId: "m-forward",
        resumeId,
        expectedRevision: 0,
        operations: [
          {
            id: "op-1",
            kind: "set_field",
            target: { section: "experience", itemId, field: "company" },
            condition: { expectedValueHash: hashTargetValue("甲公司") },
            value: "甲甲科技",
          },
        ],
      },
      { deps: depsFor(), newItemId: () => "itm_test" },
    );

    // 用户随后手改成别的值。
    await commitResumeMutation(
      { ...principal, source: "manual" },
      {
        mutationId: "m-manual",
        resumeId,
        expectedRevision: 1,
        operations: [
          {
            id: "op-manual",
            kind: "set_field",
            target: { section: "experience", itemId, field: "company" },
            condition: { expectedValueHash: hashTargetValue("甲甲科技") },
            value: "用户自己写的名字",
          },
        ],
      },
      { deps: depsFor(), newItemId: () => "itm_test3" },
    );
    expect(await currentCompany(resumeId)).toBe("用户自己写的名字");

    // 现在撤销原操作：条件（甲甲科技）已不成立 → 冲突，用户输入保留。
    const undo = await commitResumeMutation(
      { ...principal, source: "undo", undoOf: "m-forward" },
      {
        mutationId: "m-undo",
        resumeId,
        expectedRevision: 2,
        operations: [
          {
            id: "op-undo",
            kind: "set_field",
            target: { section: "experience", itemId, field: "company" },
            condition: { expectedValueHash: hashTargetValue("甲甲科技") },
            value: "甲公司",
          },
        ],
      },
      { deps: depsFor(), newItemId: () => "itm_test4" },
    );
    expect(undo.status).toBe("conflict");
    expect(await currentCompany(resumeId)).toBe("用户自己写的名字");
  });
});

describe("【独立复核发现】存量旧格式文档不得被身份初始化清空", () => {
  it("v1 的 bullets 正文在补齐身份后仍然存在", async () => {
    /*
     * 真实缺陷：编辑页把**原始 jsonb** 交给身份初始化，而
     * `initializeItemIdentities` 内部用 `ResumeContent.parse` 校验并回写。
     * v1 文档的 `experience[].bullets` 会被 Zod 剥掉、`content` 被 default 成
     * 空 doc，随后 CAS 写回库 —— 用户的文案被静默清空。
     *
     * 正确顺序：先 `migrateContent`（把旧格式转成新格式），再补齐身份。
     */
    const v1Content = {
      basics: { name: "张三", status: "", title: "", email: "", phone: "", location: "", website: "", summary: "", photo: "" },
      education: [],
      experience: [
        {
          company: "甲公司",
          title: "前端",
          start: "2020",
          end: "2021",
          location: "",
          // v1 用 bullets，没有 content
          bullets: ["主导了 X 项目", "性能提升 40%"],
        },
      ],
      projects: [],
      research: [],
      skills: [],
      custom: [],
      sectionOrder: ["basics", "experience"],
    };
    const { userId, resumeId } = await seedResume(testDb, { content: v1Content });

    // 模拟编辑页的正确做法：先迁移，再补齐身份。
    const { migrateContent } = await import("@intro-builder/shared/utils");
    const migrated = migrateContent(v1Content);
    expect(migrated.experience[0].content.content.length).toBeGreaterThan(0);

    const outcome = await initializeIdentitiesInStore(depsFor(), {
      resumeId,
      userId,
      prepare: (content) => {
        const result = initializeItemIdentities({ resumeId, content: content as ResumeContent });
        if (!result.ok) return { ok: false as const, reason: result.reason };
        return {
          ok: true as const,
          content: result.content,
          changed: result.changed,
          assignedCount: result.assigned.length,
        };
      },
    });
    expect(outcome.status).toBe("initialized");

    const after = await readResumeState(testDb, resumeId);
    const experience = (after.content as { experience: Array<{ id?: string; content: unknown }> }).experience;
    expect(experience).toHaveLength(1);
    expect(typeof experience[0].id).toBe("string");
    // 关键：正文必须还在，不能被清空。
    expect(JSON.stringify(experience[0].content)).toContain("主导了 X 项目");
  });
});
