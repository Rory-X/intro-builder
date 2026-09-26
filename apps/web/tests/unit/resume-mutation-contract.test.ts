import { describe, it, expect } from "vitest";
import { ResumeContent, emptyResumeContent } from "@intro-builder/shared/schemas";
import {
  MUTATION_ID_MAX_LENGTH,
  SemanticOperation,
  MutationCommand,
  hashTargetValue,
  RESUME_SECTION_KEYS,
  isArraySectionKey,
} from "@intro-builder/shared/schemas";

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function contentWithItems() {
  const base = emptyResumeContent();
  return ResumeContent.parse({
    ...base,
    experience: [
      { id: "exp-a", company: "A 公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("甲") },
      { id: "exp-b", company: "B 公司", title: "后端", start: "2021", end: "2022", location: "", content: doc("乙") },
    ],
    projects: [
      { id: "proj-a", name: "P1", role: "", location: "", start: "", end: "", stack: [], link: "", content: doc("丙") },
    ],
    sectionOrder: ["basics", "experience", "projects"],
  });
}

describe("命令契约：区块与字段白名单", () => {
  it("区块枚举与内容模型一致", () => {
    expect([...RESUME_SECTION_KEYS]).toContain("experience");
    expect([...RESUME_SECTION_KEYS]).toContain("basics");
    expect([...RESUME_SECTION_KEYS]).toContain("custom");
    expect([...RESUME_SECTION_KEYS]).not.toContain("styleSettings");
  });

  it("区分数组区块与单例区块", () => {
    expect(isArraySectionKey("experience")).toBe(true);
    expect(isArraySectionKey("custom")).toBe(true);
    expect(isArraySectionKey("basics")).toBe(false);
    expect(isArraySectionKey("summary")).toBe(false);
  });
});

describe("命令契约：set_field", () => {
  it("接受合法字段更新", () => {
    const parsed = SemanticOperation.safeParse({
      id: "op-1",
      kind: "set_field",
      target: { section: "experience", itemId: "exp-a", field: "company" },
      condition: { expectedValueHash: hashTargetValue("A 公司") },
      value: "甲甲科技",
    });
    expect(parsed.success).toBe(true);
  });

  it("拒绝任意属性路径（原型污染与越权字段）", () => {
    for (const field of ["__proto__", "constructor", "company.foo", "id", "ownerId", "0"]) {
      const parsed = SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_field",
        target: { section: "experience", itemId: "exp-a", field },
        condition: { expectedValueHash: "x" },
        value: "v",
      });
      expect(parsed.success, `field=${field} 必须被拒绝`).toBe(false);
    }
  });

  it("拒绝属于别的区块的字段", () => {
    const parsed = SemanticOperation.safeParse({
      id: "op-1",
      kind: "set_field",
      target: { section: "experience", itemId: "exp-a", field: "school" },
      condition: { expectedValueHash: "x" },
      value: "v",
    });
    expect(parsed.success).toBe(false);
  });

  it("单例区块不允许携带 itemId，数组区块必须携带", () => {
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_field",
        target: { section: "summary", itemId: "exp-a", field: "content" },
        condition: { expectedValueHash: "x" },
        value: doc("新的总结"),
      }).success,
    ).toBe(false);

    expect(
      SemanticOperation.safeParse({
        id: "op-2",
        kind: "set_field",
        target: { section: "experience", field: "company" },
        condition: { expectedValueHash: "x" },
        value: "v",
      }).success,
    ).toBe(false);
  });
});

describe("命令契约：insert / delete / reorder", () => {
  it("insert_item 必须给出新 ID 与相邻条目", () => {
    const ok = SemanticOperation.safeParse({
      id: "op-1",
      kind: "insert_item",
      section: "experience",
      itemId: "exp-new",
      afterItemId: "exp-a",
      expectedOrderHash: hashTargetValue(["exp-a", "exp-b"]),
      value: { company: "C", title: "", start: "", end: "", location: "", content: doc("丁") },
    });
    expect(ok.success).toBe(true);

    const missingId = SemanticOperation.safeParse({
      id: "op-1",
      kind: "insert_item",
      section: "experience",
      afterItemId: null,
      expectedOrderHash: "x",
      value: {},
    });
    expect(missingId.success).toBe(false);
  });

  it("insert_item 不接受单例区块", () => {
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "insert_item",
        section: "summary",
        itemId: "x",
        afterItemId: null,
        expectedOrderHash: "x",
        value: {},
      }).success,
    ).toBe(false);
  });

  it("delete_item 必须携带完整目标条件", () => {
    const ok = SemanticOperation.safeParse({
      id: "op-1",
      kind: "delete_item",
      target: { section: "experience", itemId: "exp-b" },
      condition: { expectedValueHash: hashTargetValue(contentWithItems().experience[1]) },
    });
    expect(ok.success).toBe(true);

    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "delete_item",
        target: { section: "experience", itemId: "exp-b" },
      }).success,
    ).toBe(false);
  });

  it("reorder_items 拒绝重复 ID 与集合不一致", () => {
    const dup = SemanticOperation.safeParse({
      id: "op-1",
      kind: "reorder_items",
      section: "experience",
      beforeIds: ["exp-a", "exp-b"],
      afterIds: ["exp-a", "exp-a"],
    });
    expect(dup.success).toBe(false);

    const mismatch = SemanticOperation.safeParse({
      id: "op-1",
      kind: "reorder_items",
      section: "experience",
      beforeIds: ["exp-a", "exp-b"],
      afterIds: ["exp-a"],
    });
    expect(mismatch.success).toBe(false);
  });

  it("set_section_order 允许重排，也允许隐藏/显示（增删成员）", () => {
    // 重排
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_section_order",
        before: ["basics", "experience"],
        after: ["experience", "basics"],
      }).success,
    ).toBe(true);

    /*
     * 隐藏 = 从 sectionOrder 移除；显示 = 加回。
     * 契约明确规定「section 隐藏通过 sectionOrder 表达，不等同于删除正文」，
     * 因此这里**必须允许**成员变化 —— 否则 hide/show 无法表达。
     * （此前的断言要求集合一致，与契约冲突，已修正。）
     */
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_section_order",
        before: ["basics", "experience", "skills"],
        after: ["basics", "experience"],
      }).success,
      "隐藏模块应当被接受",
    ).toBe(true);

    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_section_order",
        before: ["basics", "experience"],
        after: ["basics", "experience", "skills"],
      }).success,
      "显示模块应当被接受",
    ).toBe(true);

    // 重复仍然被拒绝（会让渲染与 diff 产生歧义）。
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_section_order",
        before: ["basics", "experience"],
        after: ["basics", "basics"],
      }).success,
    ).toBe(false);
  });
});

describe("命令契约：样式 / 标题 / 模板", () => {
  it("set_style 的 patch 必须落在业务 schema 取值域内", () => {
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_style",
        before: { fontSize: 13 },
        patch: { fontSize: 12 },
      }).success,
    ).toBe(true);

    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_style",
        before: { fontSize: 13 },
        patch: { fontSize: 99 },
      }).success,
    ).toBe(false);

    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_style",
        before: {},
        patch: { notAStyleField: 1 },
      }).success,
    ).toBe(false);
  });

  it("set_template 要求 resetStyle 显式给出", () => {
    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_template",
        before: "classic",
        after: "modern",
        resetStyle: true,
      }).success,
    ).toBe(true);

    expect(
      SemanticOperation.safeParse({
        id: "op-1",
        kind: "set_template",
        before: "classic",
        after: "modern",
      }).success,
    ).toBe(false);
  });

  it("set_title 只接受字符串", () => {
    expect(
      SemanticOperation.safeParse({ id: "op-1", kind: "set_title", before: "旧", after: "新" }).success,
    ).toBe(true);
    expect(
      SemanticOperation.safeParse({ id: "op-1", kind: "set_title", before: "旧", after: 1 }).success,
    ).toBe(false);
  });
});

describe("命令契约：MutationCommand", () => {
  it("接受完整命令", () => {
    const parsed = MutationCommand.safeParse({
      mutationId: "m-1",
      resumeId: "r-1",
      expectedRevision: 0,
      operations: [
        {
          id: "op-1",
          kind: "set_field",
          target: { section: "experience", itemId: "exp-a", field: "company" },
          condition: { expectedValueHash: hashTargetValue("A 公司") },
          value: "甲甲科技",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("缺少 mutationId / expectedRevision 时拒绝", () => {
    expect(
      MutationCommand.safeParse({ resumeId: "r-1", expectedRevision: 0, operations: [] }).success,
    ).toBe(false);
    expect(
      MutationCommand.safeParse({ mutationId: "m-1", resumeId: "r-1", operations: [] }).success,
    ).toBe(false);
  });

  it("expectedRevision 不接受负数或非整数", () => {
    for (const expectedRevision of [-1, 1.5, Number.NaN]) {
      expect(
        MutationCommand.safeParse({ mutationId: "m-1", resumeId: "r-1", expectedRevision, operations: [] }).success,
      ).toBe(false);
    }
  });

  it("mutationId 长度受限", () => {
    expect(
      MutationCommand.safeParse({
        mutationId: "x".repeat(MUTATION_ID_MAX_LENGTH + 1),
        resumeId: "r-1",
        expectedRevision: 0,
        operations: [],
      }).success,
    ).toBe(false);
  });

  it("ops 为空时拒绝（不会产生空提交）", () => {
    expect(
      MutationCommand.safeParse({ mutationId: "m-1", resumeId: "r-1", expectedRevision: 0, operations: [] }).success,
    ).toBe(false);
  });
});

describe("哈希：规范化且稳定", () => {
  it("对象键顺序不影响哈希", () => {
    expect(hashTargetValue({ a: 1, b: 2 })).toBe(hashTargetValue({ b: 2, a: 1 }));
  });

  it("数组顺序影响哈希", () => {
    expect(hashTargetValue([1, 2])).not.toBe(hashTargetValue([2, 1]));
  });

  it("不偷偷 trim 文本", () => {
    expect(hashTargetValue(" a ")).not.toBe(hashTargetValue("a"));
  });

  it("TipTap 文本内容变化会改变哈希", () => {
    expect(hashTargetValue(doc("甲"))).not.toBe(hashTargetValue(doc("乙")));
  });
});
