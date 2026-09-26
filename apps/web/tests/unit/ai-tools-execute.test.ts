import { describe, expect, it } from "vitest";
import { ResumeContent, emptyResumeContent } from "@intro-builder/shared/schemas";

import {
  assertToolWiringComplete,
  availableToolNames,
  executeToolCall,
  proposalOperations,
  proposalTouchesDocument,
} from "@/lib/ai/tools/execute";
import { buildAllToolDeclarations } from "@/lib/ai/tools/resume-tools";
import { createWorkspace, type WorkspaceSnapshot } from "@/lib/ai/workspace";

/**
 * 工具执行层的行为契约（P04 任务 3 + 4）。
 *
 * `resume-tools.ts` 的 builder 已有测试；这里测的是它们与实际调用之间的接线：
 *
 * 1. **声明 / schema / 必需清单三者一致** —— 缺一就会让模型调用一个
 *    「看起来存在但跑不起来」的工具。
 * 2. **参数先校验再执行** —— 模型给的 JSON 不可信；越权字段必须被拒。
 * 3. **写工具只产出提案，绝不写库** —— 提交由编排层负责。
 *    这里通过「执行层不 import 提交模块」的结构 + 提案形状来保证。
 * 4. **认不出的工具明确失败**，不返回空提案冒充成功。
 */

function doc(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function content(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "", end: "", location: "", content: doc("做甲") },
    ],
    custom: [{ id: "sec-a", title: "开源贡献", content: doc("维护某库") }],
    sectionOrder: ["basics", "experience", "skills"],
  });
}

function workspace(ws?: ResumeContent): WorkspaceSnapshot {
  return createWorkspace({
    content: ws ?? content(),
    revision: 3,
    title: "简历",
    templateId: "classic",
  });
}

function run(toolName: string, args: unknown, ws?: WorkspaceSnapshot) {
  let n = 0;
  let item = 0;
  return executeToolCall({
    toolName,
    args,
    workspace: ws ?? workspace(),
    newOpId: () => `op-${(n += 1)}`,
    newItemId: (prefix = "itm") => `${prefix}-${(item += 1)}`,
  });
}

describe("接线完整性自检", () => {
  it("声明 / schema / 必需清单三者一一对应（模块加载即自检）", () => {
    expect(() => assertToolWiringComplete()).not.toThrow();
  });

  it("声明的每个工具都有执行入口（不会返回 tool_not_implemented）", () => {
    const names = buildAllToolDeclarations().map((d) => d.name);
    expect(names.length).toBe(33);

    const notImplemented: string[] = [];
    for (const name of names) {
      // 给空参数：应当因参数不合法或目标缺失而失败，但**不应**是「缺少执行分支」。
      const outcome = run(name, {});
      if (outcome.status === "failed" && outcome.code === "tool_not_implemented") {
        notImplemented.push(name);
      }
    }
    expect(notImplemented).toEqual([]);
  });

  it("可用工具清单与声明一致（不可用的不注册）", () => {
    expect(availableToolNames().sort()).toEqual(
      buildAllToolDeclarations()
        .filter((d) => d.available)
        .map((d) => d.name)
        .sort(),
    );
  });
});

describe("参数校验在执行之前", () => {
  it("未知工具明确失败，不返回空提案", () => {
    const outcome = run("noSuchTool", {});
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("unknown_tool");
  });

  it("缺少必需参数时失败，且不产生提案", () => {
    const outcome = run("updateWorkExperienceBlock", {});
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("invalid_args");
    expect(proposalTouchesDocument(outcome)).toBe(false);
  });

  it("参数类型不符（itemId 给数字）被拒", () => {
    const outcome = run("updateWorkExperienceBlock", { itemId: 123, company: "乙" });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("invalid_args");
  });

  it("超长文本被拒（不静默截断）", () => {
    const outcome = run("writeSkillsSection", { content: "x".repeat(20001) });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("invalid_args");
  });

  it("越权字段被 schema 丢弃（模型不能自带 id）", () => {
    const outcome = run("addWorkExperience", { company: "乙公司", id: "attacker-chosen-id" });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (op.kind !== "insert_item") throw new Error("预期 insert_item");
    // 身份必须由服务端生成（injected newItemId），不能来自模型。
    expect(op.itemId).not.toBe("attacker-chosen-id");
    expect(op.itemId).toBe("itm-1");
  });
});

describe("写工具只产出提案，不写库", () => {
  it("新增经历产出 insert_item 提案，且带顺序前置条件", () => {
    const outcome = run("addWorkExperience", { company: "乙公司", title: "后端" });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    expect(ops[0].kind).toBe("insert_item");
    if (ops[0].kind === "insert_item") {
      expect(ops[0].section).toBe("experience");
      expect(ops[0].expectedOrderHash).toMatch(/^[0-9a-f]{64}$/);
      expect(ops[0].afterItemId).toBe("exp-a");
    }
  });

  it("更新条目按稳定 ID 定位（不给下标入口）", () => {
    const outcome = run("updateWorkExperienceBlock", { itemId: "exp-a", company: "甲公司（新）" });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    expect(ops.every((op) => op.kind === "set_field")).toBe(true);
    if (ops[0].kind === "set_field") {
      expect(ops[0].target.itemId).toBe("exp-a");
      expect(ops[0].condition.expectedValueHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("目标不存在时明确失败，不回退到最近似条目", () => {
    const outcome = run("updateWorkExperienceBlock", { itemId: "exp-does-not-exist", company: "X" });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("target_not_found");
  });

  it("删除是破坏性的：条件绑定整条内容", () => {
    const outcome = run("deleteWorkExperience", { itemId: "exp-a" });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    expect(ops[0].kind).toBe("delete_item");
    if (ops[0].kind === "delete_item") {
      expect(ops[0].target.itemId).toBe("exp-a");
      // 整条内容的条件：不带 field。
      expect(ops[0].target.field).toBeUndefined();
    }
  });

  it("排序集合不一致时失败（排序不隐含增删）", () => {
    const bad = run("reorderWorkExperiences", { section: "experience", itemIds: ["exp-a", "exp-b"] });
    expect(bad.status).toBe("failed");
    if (bad.status === "failed") expect(bad.code).toBe("order_set_mismatch");
  });

  it("单例富文本写 content 字段", () => {
    const outcome = run("writeSkillsSection", { content: "Go、PostgreSQL" });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    if (ops[0].kind !== "set_field") throw new Error("预期 set_field");
    expect(ops[0].target.section).toBe("skills");
    expect(ops[0].target.field).toBe("content");
  });

  it("样式工具产出 set_style 且 before 是真实当前值", () => {
    const outcome = run("updateStyleSettingsBlock", { fontSize: 13 });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    expect(ops[0].kind).toBe("set_style");
    if (ops[0].kind === "set_style") {
      expect(ops[0].patch).toEqual({ fontSize: 13 });
      // before 必须来自工作副本，不是空对象（空对象会跳过校验）。
      expect(Object.keys(ops[0].before)).toEqual(["fontSize"]);
    }
  });

  it("隐藏模块产出 set_section_order，before 是当前顺序", () => {
    const outcome = run("hideResumeModule", { section: "skills" });
    expect(outcome.status).toBe("proposed");
    const ops = proposalOperations(outcome);
    expect(ops[0].kind).toBe("set_section_order");
    if (ops[0].kind === "set_section_order") {
      expect(ops[0].before).toEqual(["basics", "experience", "skills"]);
      expect(ops[0].after).toEqual(["basics", "experience"]);
    }
  });

  it("隐藏已隐藏的模块返回 no_change 而不是假成功", () => {
    const ws = createWorkspace({
      content: ResumeContent.parse({ ...content(), sectionOrder: ["basics", "experience"] }),
      revision: 1,
      title: "t",
      templateId: "classic",
    });
    const outcome = run("hideResumeModule", { section: "skills" }, ws);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("no_change");
  });

  it("自定义模块的增 / 改 / 删 / 排序都可用", () => {
    const added = run("addCustomSection", { title: "证书", content: "AWS" });
    expect(added.status).toBe("proposed");

    const updated = run("updateCustomSectionBlock", { sectionId: "sec-a", title: "开源" });
    expect(updated.status).toBe("proposed");

    const removed = run("deleteCustomSection", { sectionId: "sec-a" });
    expect(removed.status).toBe("proposed");

    const reordered = run("reorderCustomSections", { itemIds: ["sec-a"] });
    expect(reordered.status).toBe("proposed");
  });

  it("更新不存在的自定义模块失败", () => {
    const outcome = run("updateCustomSectionBlock", { sectionId: "sec-nope", title: "x" });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("target_not_found");
  });
});

describe("只读工具不产生提案", () => {
  it("readResume 不给 section 时返回目录", () => {
    const outcome = run("readResume", {});
    expect(outcome.status).toBe("read");
    if (outcome.status === "read") {
      expect(Array.isArray(outcome.result.sections)).toBe(true);
    }
  });

  it("readResume 给 section 时返回区块字段", () => {
    const outcome = run("readResume", { section: "experience" });
    expect(outcome.status).toBe("read");
  });

  it("readResume 读不存在的区块失败", () => {
    const outcome = run("readResume", { section: "nope" });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("target_not_found");
  });

  it("suggestSkills 只给建议材料，不写入技能区块", () => {
    const outcome = run("suggestSkills", { jobDescription: "需要 Go" });
    expect(outcome.status).toBe("read");
    // 关键：只读工具绝不能产出提案（旧实现会顺手写入）。
    expect(proposalTouchesDocument(outcome)).toBe(false);
  });

  it("analyzeJobMatch 只读且要求给出岗位描述", () => {
    const ok = run("analyzeJobMatch", { jobDescription: "需要 Go 与 Postgres" });
    expect(ok.status).toBe("read");

    const bad = run("analyzeJobMatch", {});
    expect(bad.status).toBe("failed");
    if (bad.status === "failed") expect(bad.code).toBe("invalid_args");
  });

  it("askUser 返回问题而不是提案", () => {
    const outcome = run("askUser", { question: "这个项目的量化结果是什么？" });
    expect(outcome.status).toBe("read");
    if (outcome.status === "read") {
      expect(outcome.result.question).toBe("这个项目的量化结果是什么？");
      expect(typeof outcome.result.questionId).toBe("string");
    }
    expect(proposalTouchesDocument(outcome)).toBe(false);
  });
});
