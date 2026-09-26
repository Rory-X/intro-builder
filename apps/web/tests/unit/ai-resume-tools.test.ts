import { describe, expect, it } from "vitest";
import { ResumeContent, emptyResumeContent, hashTargetValue } from "@intro-builder/shared/schemas";

import {
  buildAddItem,
  buildAllToolDeclarations,
  buildCustomSection,
  buildDeleteItem,
  buildReorderItems,
  buildReorderModules,
  buildToggleModule,
  buildUpdateBasics,
  buildUpdateItem,
  buildUpdateStyle,
  buildWriteSingleton,
  textToDoc,
} from "@/lib/ai/tools/resume-tools";
import {
  TOOL_OPERATION_MAP,
  assertOperationMapCoversWrites,
  assertRequiredCapabilities,
  buildToolRegistry,
} from "@/lib/ai/tools/registry";
import { createWorkspace, type WorkspaceSnapshot } from "@/lib/ai/workspace";

function doc(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function content(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
      { id: "exp-b", company: "乙公司", title: "后端", start: "2021", end: "2022", location: "", content: doc("做乙") },
    ],
    sectionOrder: ["basics", "experience", "skills"],
  });
}

function ctx(ws?: WorkspaceSnapshot) {
  let n = 0;
  let item = 0;
  return {
    workspace: ws ?? createWorkspace({ content: content(), revision: 0, title: "t", templateId: "classic" }),
    newOpId: () => `op-${(n += 1)}`,
    newItemId: (prefix = "itm") => `${prefix}-${(item += 1)}`,
  };
}

describe("工具声明：覆盖度与自洽性", () => {
  it("全部声明通过注册表校验（含能力矩阵与操作映射）", () => {
    const declarations = buildAllToolDeclarations();
    expect(() => buildToolRegistry(declarations)).not.toThrow();
    expect(() => assertRequiredCapabilities(declarations)).not.toThrow();
  });

  it("写工具都有操作映射（提交时才能产出有效命令）", () => {
    const declarations = buildAllToolDeclarations();
    expect(() => assertOperationMapCoversWrites(declarations)).not.toThrow();
  });

  it("注册表覆盖 33 个必需工具", () => {
    const registry = buildToolRegistry(buildAllToolDeclarations());
    expect(registry.size).toBeGreaterThanOrEqual(33);
  });
});

describe("按稳定 ID 定位（不再用下标）", () => {
  it("更新条目必须给 itemId，缺了就失败并给出可操作提示", () => {
    const result = buildUpdateItem(ctx(), "experience", { company: "新公司" });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("missing_item_id");
    expect(result.message).toContain("itemId");
  });

  it("给出不存在的 itemId 时明确失败（不回退到最近似条目）", () => {
    const result = buildUpdateItem(ctx(), "experience", { itemId: "exp-no-such", company: "x" });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("target_not_found");
  });

  it("按 itemId 更新正确的条目，条件哈希来自工作副本", () => {
    const result = buildUpdateItem(ctx(), "experience", { itemId: "exp-b", company: "乙改" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    expect(op.kind).toBe("set_field");
    if (op.kind !== "set_field") return;
    expect(op.target).toMatchObject({ section: "experience", itemId: "exp-b", field: "company" });
    // 条件必须是**当时真实值**的哈希，而不是模型给的文本。
    expect(op.condition.expectedValueHash).toBe(hashTargetValue("乙公司"));
  });

  it("F03：A/B 重排后按 ID 更新仍改到原来的条目", () => {
    // 工作副本里 A/B 已交换位置。
    const swapped = ResumeContent.parse({
      ...content(),
      experience: [content().experience[1], content().experience[0]],
    });
    const result = buildUpdateItem(
      ctx(createWorkspace({ content: swapped, revision: 0, title: "t", templateId: "classic" })),
      "experience",
      { itemId: "exp-a", company: "甲改" },
    );
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "set_field") throw new Error("expected set_field");
    // 仍然指向 exp-a，而不是现在的第 0 条（那是 exp-b）。
    expect(op.target.itemId).toBe("exp-a");
  });

  it("删除条目要求给出 itemId", () => {
    const result = buildDeleteItem(ctx(), "experience", {});
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("missing_item_id");
  });

  it("删除条目用整条内容作前置条件", () => {
    const result = buildDeleteItem(ctx(), "experience", { itemId: "exp-b" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "delete_item") throw new Error("expected delete_item");
    expect(op.condition.expectedValueHash).toBe(hashTargetValue(content().experience[1]));
  });
});

describe("新增条目：身份由服务端生成", () => {
  it("新增经历产出 insert_item，锚点为最后一条", () => {
    const result = buildAddItem(ctx(), "experience", { company: "丙公司", content: "做丙" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "insert_item") throw new Error("expected insert_item");
    expect(op.section).toBe("experience");
    expect(op.afterItemId).toBe("exp-b");
    // 顺序条件是**插入前**的 ID 列表。
    expect(op.expectedOrderHash).toBe(hashTargetValue(["exp-a", "exp-b"]));
    // 新条目的 ID 由服务端生成，模型无法指定。
    expect(op.itemId).toBeTruthy();
  });

  it("空区块新增时锚点为 null", () => {
    const empty = ResumeContent.parse({ ...emptyResumeContent(), sectionOrder: ["basics"] });
    const result = buildAddItem(
      ctx(createWorkspace({ content: empty, revision: 0, title: "t", templateId: "classic" })),
      "projects",
      { name: "项目" },
    );
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "insert_item") throw new Error("expected insert_item");
    expect(op.afterItemId).toBeNull();
  });

  it("新增教育经历写入 highlights（不是 content）", () => {
    const result = buildAddItem(ctx(), "education", { school: "S 大学", highlights: "在校经历" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "insert_item") throw new Error("expected insert_item");
    expect(op.value).toHaveProperty("highlights");
    expect(op.value).not.toHaveProperty("content");
  });

  it("文本转 TipTap：全 '-' 行转无序列表，其余转段落", () => {
    const bullets = textToDoc("- 做了甲\n- 做了乙");
    expect((bullets.content as Array<{ type: string }>)[0].type).toBe("bulletList");

    const paragraphs = textToDoc("第一段\n第二段");
    expect((paragraphs.content as Array<{ type: string }>)[0].type).toBe("paragraph");

    // 空文本给一个空段落，不给空数组（空 doc 会让渲染器报错）。
    expect((textToDoc("").content as unknown[]).length).toBe(1);
  });
});

describe("排序：集合必须一致", () => {
  it("覆盖全部条目时通过", () => {
    const result = buildReorderItems(ctx(), {
      section: "experience",
      itemIds: ["exp-b", "exp-a"],
    });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "reorder_items") throw new Error("expected reorder_items");
    expect(op.beforeIds).toEqual(["exp-a", "exp-b"]);
    expect(op.afterIds).toEqual(["exp-b", "exp-a"]);
  });

  it("少给或多给条目时失败并列出当前条目（便于模型纠正）", () => {
    const result = buildReorderItems(ctx(), { section: "experience", itemIds: ["exp-a"] });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("order_set_mismatch");
    expect(result.message).toContain("exp-a");
    expect(result.message).toContain("exp-b");
  });
});

describe("基础信息与单例区块", () => {
  it("基础信息每个字段产出一条操作（契约里 basics 的字段级值是字符串）", () => {
    const result = buildUpdateBasics(ctx(), { name: "李四", phone: "138" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    // 只处理给出了的字段；每个字段一条 set_field，而不是把对象塞进 value
    // （契约中 basics 的字段级值类型是 string，整个对象不符合类型契约）。
    expect(result.operations).toHaveLength(2);
    const targets = result.operations.map((op) => (op.kind === "set_field" ? op.target.field : null));
    expect(targets.sort()).toEqual(["name", "phone"]);
    for (const op of result.operations) {
      if (op.kind !== "set_field") throw new Error("expected set_field");
      expect(op.target.section).toBe("basics");
      expect(typeof op.value).toBe("string");
    }
  });

  it("没有给出任何字段时失败（不产生空提案）", () => {
    const result = buildUpdateBasics(ctx(), {});
    expect(result.status).toBe("failed");
  });

  it("单例富文本写入 content 字段", () => {
    const result = buildWriteSingleton(ctx(), "skills", { content: "TypeScript、React" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "set_field") throw new Error("expected set_field");
    expect(op.target).toEqual({ section: "skills", field: "content" });
  });

  it("单例区块缺 content 时失败", () => {
    expect(buildWriteSingleton(ctx(), "summary", {}).status).toBe("failed");
  });
});

describe("排版与模块顺序", () => {
  it("排版只包含给出的项，并记录改动前的值", () => {
    const result = buildUpdateStyle(ctx(), { fontSize: 12 });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "set_style") throw new Error("expected set_style");
    expect(op.patch).toEqual({ fontSize: 12 });
    expect(op.before).toHaveProperty("fontSize");
  });

  it("隐藏/显示模块通过 sectionOrder 表达（不删除正文）", () => {
    const hide = buildToggleModule(ctx(), "skills", false);
    expect(hide.status).toBe("proposed");
    if (hide.status !== "proposed") return;
    const op = hide.operations[0];
    if (op.kind !== "set_section_order") throw new Error("expected set_section_order");
    expect(op.after).not.toContain("skills");
    // 正文仍在内容里 —— 隐藏不等于删除。
    expect(op.after.length).toBe(op.before.length - 1);
  });

  it("重复隐藏（已经隐藏）时明确告知无需改动", () => {
    const result = buildToggleModule(ctx(), "awards", false);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("no_change");
  });

  it("模块排序集合必须一致", () => {
    const ok = buildReorderModules(ctx(), { sectionOrder: ["experience", "basics", "skills"] });
    expect(ok.status).toBe("proposed");

    const bad = buildReorderModules(ctx(), { sectionOrder: ["experience"] });
    expect(bad.status).toBe("failed");
  });

  it("新增自定义模块产出 insert_item 并返回新 ID 供后续引用", () => {
    const result = buildCustomSection(ctx(), { title: "开源贡献", content: "维护 X" });
    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") return;
    const op = result.operations[0];
    if (op.kind !== "insert_item") throw new Error("expected insert_item");
    expect(op.section).toBe("custom");
    expect(result.note).toContain(op.itemId);
  });

  it("自定义模块缺标题时失败", () => {
    expect(buildCustomSection(ctx(), {}).status).toBe("failed");
  });
});

describe("提案中的操作都符合提交契约", () => {
  it("产出的操作能被提交层的 schema 接受", async () => {
    const { MutationCommand } = await import("@intro-builder/shared/schemas");
    const results = [
      buildUpdateBasics(ctx(), { name: "李四" }),
      buildAddItem(ctx(), "experience", { company: "丙" }),
      buildUpdateItem(ctx(), "experience", { itemId: "exp-a", company: "甲改" }),
      buildDeleteItem(ctx(), "experience", { itemId: "exp-b" }),
      buildReorderItems(ctx(), { section: "experience", itemIds: ["exp-b", "exp-a"] }),
      buildWriteSingleton(ctx(), "skills", { content: "x" }),
      buildUpdateStyle(ctx(), { fontSize: 12 }),
      buildToggleModule(ctx(), "skills", false),
    ];
    for (const result of results) {
      expect(result.status).toBe("proposed");
      if (result.status !== "proposed") continue;
      const parsed = MutationCommand.safeParse({
        mutationId: "m-1",
        resumeId: "r-1",
        expectedRevision: 0,
        operations: result.operations,
      });
      expect(
        parsed.success,
        `提案未通过契约：${JSON.stringify(result.operations.map((o) => o.kind))} ${
          parsed.success ? "" : JSON.stringify(parsed.error.issues)
        }`,
      ).toBe(true);
    }
  });

  it("TOOL_OPERATION_MAP 覆盖我声明的每个写工具", () => {
    for (const declaration of buildAllToolDeclarations()) {
      if (declaration.capability !== "write") continue;
      expect(
        TOOL_OPERATION_MAP[declaration.name],
        `${declaration.name} 缺少操作映射`,
      ).toBeDefined();
    }
  });
});
