import { describe, expect, it } from "vitest";

import {
  REQUIRED_TOOL_NAMES,
  TOOL_OPERATION_MAP,
  ToolCapabilityError,
  assertOperationMapCoversWrites,
  assertRequiredCapabilities,
  assertToolDeclarationValid,
  buildToolRegistry,
  summarizeCapabilities,
  type ToolDeclaration,
} from "@/lib/ai/tools/registry";

function declaration(overrides: Partial<ToolDeclaration> = {}): ToolDeclaration {
  return {
    name: "readResume",
    description: "读取简历的指定区块。",
    capability: "read",
    target: { kind: "meta" },
    available: true,
    ...overrides,
  };
}

describe("工具声明自洽性", () => {
  it("合法的只读工具通过", () => {
    expect(() => assertToolDeclarationValid(declaration())).not.toThrow();
  });

  it("写工具必须声明它能产生的操作种类", () => {
    /*
     * 这条检查挡住的是真实缺陷：没有操作种类的写工具不可能产出有效命令，
     * 它不该被注册 —— 否则模型会认真地调用它，然后拿到一个没用的结果，
     * 用户看到的是「AI 说要改但没改」。
     */
    expect(() =>
      assertToolDeclarationValid(
        declaration({
          name: "updateBasicsBlock",
          capability: "write",
          target: { kind: "singleton", section: "basics" },
        }),
      ),
    ).toThrow(/未声明它能产生的语义操作/);
  });

  it("只读工具声明操作种类视为矛盾", () => {
    expect(() =>
      assertToolDeclarationValid(declaration({ produces: ["set_field"] })),
    ).toThrow(/矛盾/);
  });

  it("缺少面向模型的说明时报错", () => {
    expect(() => assertToolDeclarationValid(declaration({ description: "  " }))).toThrow(/缺少/);
  });

  it("标记不可用但不给原因时报错", () => {
    expect(() => assertToolDeclarationValid(declaration({ available: false }))).toThrow(/未说明原因/);
  });

  it("标记不可用并给了原因时通过", () => {
    expect(() =>
      assertToolDeclarationValid(
        declaration({ available: false, unavailableReason: "该能力尚未迁移到 Web 运行时" }),
      ),
    ).not.toThrow();
  });
});

describe("注册表构建", () => {
  it("只注册可用工具（不可用的不出现在模型工具列表里）", () => {
    const registry = buildToolRegistry([
      declaration({ name: "readResume" }),
      declaration({
        name: "writeSkillsSection",
        capability: "write",
        produces: ["set_field"],
        target: { kind: "singleton", section: "skills" },
        available: false,
        unavailableReason: "尚未实现",
      }),
    ]);
    expect(registry.has("readResume")).toBe(true);
    // 关键：不可用工具**不注册**，而不是注册后返回 unavailable。
    expect(registry.has("writeSkillsSection")).toBe(false);
  });

  it("任何一条声明不自洽就快速失败（不静默跳过）", () => {
    expect(() =>
      buildToolRegistry([
        declaration({ name: "ok" }),
        declaration({ name: "bad", capability: "write" }),
      ]),
    ).toThrow(ToolCapabilityError);
  });

  it("工具名重复时报错", () => {
    expect(() => buildToolRegistry([declaration({ name: "dup" }), declaration({ name: "dup" })])).toThrow(
      /重复/,
    );
  });

  it("能力摘要如实计数", () => {
    const registry = buildToolRegistry([
      declaration({ name: "readResume" }),
      declaration({ name: "askUser", capability: "ask", target: { kind: "meta" } }),
      declaration({
        name: "updateBasicsBlock",
        capability: "write",
        produces: ["set_field"],
        target: { kind: "singleton", section: "basics" },
      }),
      declaration({
        name: "addWorkExperience",
        capability: "write",
        produces: ["insert_item"],
        target: { kind: "array", section: "experience" },
      }),
    ]);
    const summary = summarizeCapabilities(registry);
    expect(summary.reads).toBe(1);
    expect(summary.asks).toBe(1);
    expect(summary.writes).toBe(2);
    expect(summary.writableSections).toEqual(["basics", "experience"]);
  });
});

describe("必需能力覆盖", () => {
  it("缺少必需工具时报错并指出缺什么", () => {
    expect(() =>
      assertRequiredCapabilities([declaration({ name: "readResume" })]),
    ).toThrow(/缺少必需的工具能力/);
  });

  it("标记为不可用的必需工具视为缺失（不能用占位工具充数）", () => {
    const declarations: ToolDeclaration[] = [
      ...REQUIRED_TOOL_NAMES.map<ToolDeclaration>((name) => {
        const isWrite = Boolean(TOOL_OPERATION_MAP[name]);
        return declaration({
          name,
          capability: isWrite ? "write" : name === "askUser" ? "ask" : "read",
          produces: isWrite ? TOOL_OPERATION_MAP[name] : undefined,
          target: { kind: "meta" },
        });
      }),
    ];
    expect(() => assertRequiredCapabilities(declarations)).not.toThrow();

    // 把其中一个标记为不可用 → 应当报缺失。
    const withDisabled = declarations.map((d) =>
      d.name === "addProject"
        ? { ...d, available: false, unavailableReason: "临时下线" }
        : d,
    );
    expect(() => assertRequiredCapabilities(withDisabled)).toThrow(/addProject/);
  });

  it("必需清单覆盖规格列出的各语义工具类别", () => {
    for (const name of [
      "updateBasicsBlock",
      "addWorkExperience",
      "deleteWorkExperience",
      "reorderWorkExperiences",
      "writeSkillsSection",
      "addCustomSection",
      "updateStyleSettingsBlock",
      "hideResumeModule",
      "readResume",
      "askUser",
      "analyzeJobMatch",
    ]) {
      expect(REQUIRED_TOOL_NAMES, `缺少 ${name}`).toContain(name);
    }
  });
});

describe("工具 → 语义操作映射", () => {
  it("写工具必须有映射，否则提交时无法产出命令", () => {
    const declarations: ToolDeclaration[] = [
      declaration({
        name: "brandNewTool",
        capability: "write",
        produces: ["set_field"],
        target: { kind: "singleton", section: "summary" },
      }),
    ];
    expect(() => assertOperationMapCoversWrites(declarations)).toThrow(/没有对应的语义操作映射/);
  });

  it("已有映射的写工具通过", () => {
    const declarations: ToolDeclaration[] = [
      declaration({
        name: "updateBasicsBlock",
        capability: "write",
        produces: TOOL_OPERATION_MAP.updateBasicsBlock,
        target: { kind: "singleton", section: "basics" },
      }),
    ];
    expect(() => assertOperationMapCoversWrites(declarations)).not.toThrow();
  });

  it("映射里的操作种类都属于提交层支持的封闭联合", () => {
    const supported = new Set([
      "set_field",
      "insert_item",
      "delete_item",
      "reorder_items",
      "set_section_order",
      "set_style",
      "set_title",
      "set_template",
    ]);
    for (const [tool, kinds] of Object.entries(TOOL_OPERATION_MAP)) {
      for (const kind of kinds) {
        expect(supported, `${tool} 产出的 ${kind} 不在提交层支持范围内`).toContain(kind);
      }
    }
  });
});
