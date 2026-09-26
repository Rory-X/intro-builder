import { describe, expect, it } from "vitest";
import { emptyResumeContent, ResumeContent, hashTargetValue } from "@intro-builder/shared/schemas";

import {
  allItemIds,
  conditionHashFor,
  createWorkspace,
  describeSections,
  estimateCompleteness,
  promoteToBase,
  readSection,
  stageChange,
} from "@/lib/ai/workspace";

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function baseContent(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
      { id: "exp-b", company: "乙公司", title: "后端", start: "2021", end: "2022", location: "", content: doc("做乙") },
    ],
    sectionOrder: ["basics", "experience"],
  });
}

const source = () => ({
  content: baseContent(),
  revision: 3,
  title: "我的简历",
  templateId: "classic",
});

describe("工作副本：基准与暂存修改", () => {
  it("从服务端权威内容初始化，并保留 revision", () => {
    const ws = createWorkspace(source());
    expect(ws.revision).toBe(3);
    expect(ws.changes).toHaveLength(0);
    expect(ws.current.experience).toHaveLength(2);
  });

  it("初始化是深拷贝：外部对象后续变化不影响工作副本", () => {
    const input = source();
    const ws = createWorkspace(input);
    (input.content.experience[0] as { company: string }).company = "被外部改了";
    expect(ws.current.experience[0].company).toBe("甲公司");
    expect(ws.base.experience[0].company).toBe("甲公司");
  });

  it("F02：同一轮内先新增条目、再读它，能读到（旧实现读不到）", () => {
    const ws = createWorkspace(source());
    const inserted = ResumeContent.parse({
      ...ws.current,
      experience: [
        ...ws.current.experience,
        { id: "exp-new", company: "丙公司", title: "全栈", start: "", end: "", location: "", content: doc("做丙") },
      ],
    });
    const staged = stageChange(ws, {
      operationId: "op-1",
      kind: "insert_item",
      nextContent: inserted,
      summary: "新增一条经历",
    });

    const read = readSection(staged, { section: "experience", itemId: "exp-new" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.fields.company).toBe("丙公司");
  });

  it("暂存修改不改变基准（基准仍用于并发校验）", () => {
    const ws = createWorkspace(source());
    const modified = ResumeContent.parse({
      ...ws.current,
      basics: { ...ws.current.basics, name: "李四" },
    });
    const staged = stageChange(ws, {
      operationId: "op-1",
      kind: "set_field",
      nextContent: modified,
      summary: "改姓名",
    });
    expect(staged.current.basics.name).toBe("李四");
    // 基准保持不变 —— 它是提交时的 CAS 依据。
    expect(staged.base.basics.name).toBe("张三");
    expect(staged.revision).toBe(3);
  });

  it("promoteToBase 把已提交内容提升为新基准并清空暂存", () => {
    const ws = createWorkspace(source());
    const promoted = promoteToBase(ws, {
      content: ResumeContent.parse({ ...ws.current, basics: { ...ws.current.basics, name: "李四" } }),
      revision: 4,
    });
    expect(promoted.base.basics.name).toBe("李四");
    expect(promoted.current.basics.name).toBe("李四");
    expect(promoted.revision).toBe(4);
    expect(promoted.changes).toHaveLength(0);
  });

  it("promoteToBase 深拷贝提交内容（避免后续改动污染基准）", () => {
    const ws = createWorkspace(source());
    const committed = ResumeContent.parse({ ...ws.current, basics: { ...ws.current.basics, name: "李四" } });
    const promoted = promoteToBase(ws, { content: committed, revision: 4 });
    (committed.basics as { name: string }).name = "又被改了";
    expect(promoted.base.basics.name).toBe("李四");
  });
});

describe("按需读取：目录与目标", () => {
  it("目录列出区块、条目数与每条的稳定 ID", () => {
    const ws = createWorkspace(source());
    const sections = describeSections(ws);
    const experience = sections.find((s) => s.section === "experience");
    expect(experience?.itemCount).toBe(2);
    expect(experience?.items.map((i) => i.itemId)).toEqual(["exp-a", "exp-b"]);
    // 预览应包含可辨识的摘要，供模型判断该读哪一条。
    expect(experience?.items[0].preview).toContain("甲公司");
  });

  it("自定义区块按模块 id 单独列出", () => {
    const content = ResumeContent.parse({
      ...baseContent(),
      custom: [{ id: "sec-1", title: "开源贡献", content: doc("维护了 X 项目") }],
    });
    const ws = createWorkspace({ content, revision: 0, title: "t", templateId: "classic" });
    const sections = describeSections(ws);
    const custom = sections.find((s) => s.section === "custom:sec-1");
    expect(custom?.label).toBe("开源贡献");
    expect(custom?.isEmpty).toBe(false);
  });

  it("读取单条条目返回其完整字段", () => {
    const ws = createWorkspace(source());
    const read = readSection(ws, { section: "experience", itemId: "exp-b" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.fields.company).toBe("乙公司");
  });

  it("目标不存在时明确报错，不回退到最近似条目", () => {
    const ws = createWorkspace(source());
    const read = readSection(ws, { section: "experience", itemId: "exp-not-exist" });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe("not_found");
  });

  it("读取整个区块（不带 itemId）返回该区块的值", () => {
    const ws = createWorkspace(source());
    const read = readSection(ws, { section: "basics" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.fields.name).toBe("张三");
  });

  it("对条目型区块不带 itemId 也能读到列表", () => {
    const ws = createWorkspace(source());
    const read = readSection(ws, { section: "experience" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Array.isArray(read.fields)).toBe(true);
  });

  it("allItemIds 反映当前（含暂存）的条目集合", () => {
    const ws = createWorkspace(source());
    expect(allItemIds(ws).experience).toEqual(["exp-a", "exp-b"]);

    const inserted = ResumeContent.parse({
      ...ws.current,
      experience: [
        ...ws.current.experience,
        { id: "exp-new", company: "丙", title: "", start: "", end: "", location: "", content: doc("") },
      ],
    });
    const staged = stageChange(ws, { operationId: "op", kind: "insert_item", nextContent: inserted, summary: "" });
    expect(allItemIds(staged).experience).toEqual(["exp-a", "exp-b", "exp-new"]);
  });
});

describe("条件哈希由服务端重算（模型不能编造）", () => {
  it("字段级目标返回该字段的哈希", () => {
    const ws = createWorkspace(source());
    const hash = conditionHashFor(ws, {
      section: "experience",
      itemId: "exp-a",
      field: "company",
    });
    expect(hash).toBe(hashTargetValue("甲公司"));
  });

  it("条目级目标返回整条的哈希（删除场景）", () => {
    const ws = createWorkspace(source());
    const hash = conditionHashFor(ws, { section: "experience", itemId: "exp-b" });
    expect(hash).toBe(hashTargetValue(baseContent().experience[1]));
  });

  it("目标不存在时返回 null（调用方据此拒绝提案）", () => {
    const ws = createWorkspace(source());
    expect(
      conditionHashFor(ws, { section: "experience", itemId: "missing", field: "company" }),
    ).toBeNull();
  });

  it("暂存修改后哈希随工作副本变化（下一轮提案基于最新状态）", () => {
    const ws = createWorkspace(source());
    const modified = ResumeContent.parse({
      ...ws.current,
      experience: [{ ...ws.current.experience[0], company: "甲改" }, ws.current.experience[1]],
    });
    const staged = stageChange(ws, { operationId: "op", kind: "set_field", nextContent: modified, summary: "" });
    expect(
      conditionHashFor(staged, { section: "experience", itemId: "exp-a", field: "company" }),
    ).toBe(hashTargetValue("甲改"));
  });
});

describe("完整性是估算，不是事实", () => {
  it("返回估算值并明确标注局限", () => {
    const ws = createWorkspace(source());
    const result = estimateCompleteness(ws);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    // 必须带免责说明：旧实现把启发式当权威指标展示。
    expect(result.disclaimer).toContain("估算");
  });

  it("各区块如实区分已填/未填", () => {
    const ws = createWorkspace(source());
    const result = estimateCompleteness(ws);
    const experience = result.sections.find((s) => s.key === "experience");
    const projects = result.sections.find((s) => s.key === "projects");
    expect(experience?.filled).toBe(true);
    expect(projects?.filled).toBe(false);
  });
});
