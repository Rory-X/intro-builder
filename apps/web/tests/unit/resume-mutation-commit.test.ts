import { describe, expect, it } from "vitest";

import { COMMIT_HTTP_STATUS, type CommitResult } from "@intro-builder/shared/schemas";
import { buildCommitStatement, buildReceiptLookupStatement } from "@/lib/resume-mutations/store";

/**
 * 提交层的**纯**断言（不需要数据库）。
 *
 * 事务正确性在 `tests/integration/` 用真实 PostgreSQL 证明；这里只锁住那些
 * 「看一眼就能验证、但错了会很难查」的结构性约定。
 */

function baseParams() {
  return {
    resumeId: "r-1",
    userId: "u-1",
    expectedRevision: 0,
    nextContentJson: JSON.stringify({ basics: {} }),
    nextRevision: 1,
    nextTitle: null,
    nextTemplateId: null,
    mutationId: "m-1",
    mutationRowId: "row-1",
    requestHash: "hash-1",
    operationIdsJson: JSON.stringify(["op-1"]),
    operationCount: 1,
    beforeJson: JSON.stringify(["旧"]),
    afterJson: JSON.stringify(["新"]),
    source: "manual",
    actorName: "张三",
    summary: null,
    undoOf: null,
    changeSetId: null,
    changeSetVersion: null,
    decisionId: null,
    versionId: "v-1",
    eventId: "e-1",
    runId: null,
  };
}

function renderSql(statement: unknown): string {
  let counter = 0;
  function walk(node: unknown): string {
    const c = node as { value?: unknown; queryChunks?: unknown[] };
    if (c && Array.isArray(c.queryChunks)) return c.queryChunks.map(walk).join("");
    if (c && Array.isArray(c.value)) return (c.value as string[]).join("");
    if (typeof c?.value === "string") return c.value;
    counter += 1;
    return `$${counter}`;
  }
  return walk(statement);
}
describe("提交 SQL：结构与原子性约束", () => {
  const sqlText = renderSql(buildCommitStatement(baseParams()));

  it("正文更新以 revision 作为 CAS 条件（不能只按 id 更新）", () => {
    // 无 fence 分支（baseParams 不带 fence）。
    expect(sqlText).toMatch(/UPDATE "resume"/);
    expect(sqlText).toMatch(/AND revision = \$/);
    expect(sqlText).toMatch(/AND "userId" = \$/);
  });

  it("携带 fence 时在同一条语句内核验 Run 仍可写（取消能拦住晚到提交）", () => {
    const fenced = renderSql(
      buildCommitStatement({ ...baseParams(), fenceRunId: "run-1", fenceToken: 7 }),
    );
    // 关键：fence 条件是 UPDATE 的 FROM 连接条件，而不是调用方在写之前查一次。
    expect(fenced).toMatch(/FROM fence_ok/);
    expect(fenced).toMatch(/"fenceToken" = \$/);
    expect(fenced).toMatch(/"cancelRequestedAt" IS NULL/);
    expect(fenced).toMatch(/status NOT IN \('completed', 'failed', 'cancelled'\)/);
  });

  it("不携带 fence 时走无 FROM 的分支（普通手动编辑不受影响）", () => {
    const plain = renderSql(buildCommitStatement({ ...baseParams(), fenceRunId: null, fenceToken: null }));
    expect(plain).not.toMatch(/FROM fence_ok/);
    expect(plain).toMatch(/AND revision = \$/);
  });

  it("后续插入都从 UPDATE ... RETURNING 派生（0 行时不会假装成功）", () => {
    // 版本、回执、事件三处都必须 JOIN 到 updated / version_inserted，
    // 而不是各自独立插入 —— 否则 UPDATE 影响 0 行时仍会写出成功记录。
    expect(sqlText).toMatch(/FROM updated u/);
    expect((sqlText.match(/JOIN version_inserted v ON true/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sqlText).toMatch(/RETURNING id, revision, content, title, "templateId"/);
  });

  it("四个写入在同一个 CTE 语句内（单条 SQL）", () => {
    // 无 fence 时 WITH 直接以 updated 开头；带 fence 时先有 fence_ok（另见下方用例）。
    expect(sqlText).toMatch(/WITH\s+updated AS \(/);
    for (const cte of ["version_inserted AS", "receipt AS", "event_inserted AS"]) {
      expect(sqlText, `缺少 CTE ${cte}`).toContain(cte);
    }
    // 语句里不应出现显式的 BEGIN/COMMIT —— Neon HTTP 不支持交互式事务。
    expect(sqlText).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
  });

  it("回执行使用独立主键，不复用 mutationId", () => {
    // 复用会让两个用户各自的 "m-1" 撞主键。
    expect(sqlText).toMatch(/INSERT INTO "resume_mutation"/);
    // 参数化后无法直接看到值，改为断言字段列表里同时存在 id 与 mutationId。
    expect(sqlText).toMatch(/"id", "mutationId"/);
  });

  it("outbox 事件与正文写在同一条语句里", () => {
    expect(sqlText).toMatch(/INSERT INTO "resume_mutation_event"/);
    expect(sqlText).toMatch(/'mutation\.committed'/);
  });

  it("正文以参数传入（SQL 文本中不出现简历正文）", () => {
    const params = baseParams();
    params.nextContentJson = JSON.stringify({ basics: { name: "不应出现在SQL里的名字" } });
    const rendered = renderSql(buildCommitStatement(params));
    expect(rendered).not.toContain("不应出现在SQL里的名字");
  });
});

describe("回执查询：必须跨事务重查", () => {
  it("以 (resumeId, mutationId) 定位，并按 resumeId 限定事件子查询", () => {
    const sqlText = renderSql(buildReceiptLookupStatement("r-1", "m-1"));
    expect(sqlText).toMatch(/WHERE m\."resumeId" = \$1 AND m\."mutationId" = \$2/);
    expect(sqlText).toMatch(/e\."resumeId" = m\."resumeId"/);
  });
});

describe("HTTP 状态映射（契约 §3）", () => {
  it("冲突是 409、非法操作是 422，不能用 200 包装失败", () => {
    const statuses: Record<CommitResult["status"], number> = COMMIT_HTTP_STATUS;
    expect(statuses.conflict).toBe(409);
    expect(statuses.rejected).toBe(422);
    expect(statuses.committed).toBe(200);
    // no_change 是成功语义（无变化），但仍不应被误当成「已提交」。
    expect(statuses.no_change).toBe(200);
  });
});
