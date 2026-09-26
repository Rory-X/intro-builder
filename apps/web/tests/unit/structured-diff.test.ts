import { describe, expect, it } from "vitest";
import { ResumeContent, emptyResumeContent } from "@intro-builder/shared/schemas";

import {
  buildStructuredDiff,
  hasLegacyComparison,
  movedItemIds,
} from "@/lib/resume-mutations/diff";

/**
 * 结构化 Diff 的契约（P06 任务 4）。
 *
 * plan 的四条硬要求，每条都对应现有实现的一个缺口：
 *
 * 1. **按 ID 匹配条目，不按下标**。下标在下标变化后指向别的条目，
 *    于是「A 被改」会渲染成「A 被删、B 新增」。
 * 2. **明确识别移动**。两条经历只交换位置时必须报 `moved` ——
 *    这是 plan「用户可见验收」的最后一条明确要求的。
 * 3. **覆盖自定义模块、标题、模板、样式、sectionOrder**。
 * 4. **历史无 ID 时标 `legacy` 并使用受限比较**，不能渲染成可信来源证明。
 */

function exp(id: string, company: string, content = "做项目") {
  return {
    id,
    company,
    title: "工程师",
    start: "2020",
    end: "2021",
    location: "",
    content: { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] },
  };
}

function base(overrides: Record<string, unknown> = {}): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [exp("exp-a", "甲公司"), exp("exp-b", "乙公司")],
    projects: [{ id: "proj-a", name: "项目甲", role: "", location: "", start: "", end: "", stack: [], link: "", content: { type: "doc", content: [] } }],
    sectionOrder: ["basics", "experience", "projects"],
    ...overrides,
  });
}

describe("按 ID 匹配（不按下标）", () => {
  it("同一顺序时无变化", () => {
    const diff = buildStructuredDiff(base(), base());
    const experience = diff.sections.find((section) => section.section === "experience");
    expect(experience?.items.every((item) => item.status === "unchanged")).toBe(true);
    expect(diff.hasChanges).toBe(false);
  });

  it("**只交换位置 → 报 moved，不是「删两条 + 增两条」**（plan 验收第 4 条）", () => {
    const before = base();
    const after = base({ experience: [exp("exp-b", "乙公司"), exp("exp-a", "甲公司")] });
    const diff = buildStructuredDiff(before, after);

    const experience = diff.sections.find((section) => section.section === "experience");
    expect(experience).toBeDefined();
    // 关键：两条都被识别为 moved，而不是 added/removed。
    const statuses = experience?.items.map((item) => item.status).sort();
    expect(statuses).toEqual(["moved", "moved"]);
    // 且没有任何条目内容被改写 —— 交换位置不该产生字段改动。
    expect(experience?.items.every((item) => item.changedFields.length === 0)).toBe(true);
    expect(movedItemIds(diff).sort()).toEqual(["exp-a", "exp-b"]);
  });

  it("按下标比较会把「改名 + 移动」渲染错；按 ID 不会", () => {
    // 把 exp-b 挪到前面，同时改了它的公司名。
    const after = base({
      experience: [exp("exp-b", "乙公司（已改名）"), exp("exp-a", "甲公司")],
    });
    const diff = buildStructuredDiff(base(), after);
    const experience = diff.sections.find((section) => section.section === "experience");

    const moved = experience?.items.find((item) => item.itemId === "exp-b");
    // 报了 modified（内容变了），且带上真实的新旧位置 —— 用户需要知道「挪了并且改了」。
    expect(moved?.status).toBe("modified");
    expect(moved?.oldIndex).toBe(1);
    expect(moved?.newIndex).toBe(0);
    expect(moved?.changedFields.map((f) => f.field)).toContain("company");
  });

  it("新增条目：oldIndex 为 -1", () => {
    const after = base({ experience: [exp("exp-a", "甲公司"), exp("exp-b", "乙公司"), exp("exp-c", "丙公司")] });
    const diff = buildStructuredDiff(base(), after);
    const added = diff.sections.find((s) => s.section === "experience")?.items.find((i) => i.itemId === "exp-c");
    expect(added?.status).toBe("added");
    expect(added?.oldIndex).toBe(-1);
    expect(added?.newIndex).toBe(2);
  });

  it("删除条目：newIndex 为 -1", () => {
    const after = base({ experience: [exp("exp-a", "甲公司")] });
    const diff = buildStructuredDiff(base(), after);
    const removed = diff.sections.find((s) => s.section === "experience")?.items.find((i) => i.itemId === "exp-b");
    expect(removed?.status).toBe("removed");
    expect(removed?.newIndex).toBe(-1);
  });

  it("`id` 的变化不算「内容字段改动」（身份不是内容）", () => {
    const after = base({ experience: [{ ...exp("exp-a", "甲公司"), id: "exp-a" }, exp("exp-b", "乙公司")] });
    const diff = buildStructuredDiff(base(), after);
    const experience = diff.sections.find((s) => s.section === "experience");
    expect(experience?.items.every((item) => item.changedFields.every((f) => f.field !== "id"))).toBe(true);
  });
});

describe("历史无 ID → 受限比较且标注", () => {
  it("两侧都缺 ID 时标 legacyComparison", () => {
    const withoutIds = ResumeContent.parse({
      ...emptyResumeContent(),
      experience: [{ company: "甲公司", title: "工程师", start: "", end: "", location: "", content: { type: "doc", content: [] } }],
    });
    const diff = buildStructuredDiff(withoutIds, withoutIds);
    const experience = diff.sections.find((s) => s.section === "experience");
    expect(experience?.legacyComparison).toBe(true);
  });

  it("**部分条目缺 ID 也算受限**（混用两种对齐方式会自相矛盾）", () => {
    const mixed = ResumeContent.parse({
      ...emptyResumeContent(),
      experience: [exp("exp-a", "甲公司"), { company: "乙公司", title: "", start: "", end: "", location: "", content: { type: "doc", content: [] } }],
    });
    const diff = buildStructuredDiff(mixed, mixed);
    expect(diff.sections.find((s) => s.section === "experience")?.legacyComparison).toBe(true);
  });

  it("受限比较**不报 moved**（无 ID 时无法区分移动与改写）", () => {
    const withoutIds = (label: string) =>
      ResumeContent.parse({
        ...emptyResumeContent(),
        experience: [
          { company: label, title: "", start: "", end: "", location: "", content: { type: "doc", content: [] } },
        ],
      });
    const diff = buildStructuredDiff(withoutIds("甲"), withoutIds("乙"));
    expect(movedItemIds(diff)).toEqual([]);
  });

  it("hasLegacyComparison 只在受限**且有变化**时为 true", () => {
    const withoutIds = ResumeContent.parse({
      ...emptyResumeContent(),
      experience: [{ company: "甲公司", title: "", start: "", end: "", location: "", content: { type: "doc", content: [] } }],
    });
    // 无变化 → 不需要标注。
    expect(hasLegacyComparison(buildStructuredDiff(withoutIds, withoutIds))).toBe(false);

    const changed = ResumeContent.parse({
      ...emptyResumeContent(),
      experience: [{ company: "乙公司", title: "", start: "", end: "", location: "", content: { type: "doc", content: [] } }],
    });
    expect(hasLegacyComparison(buildStructuredDiff(withoutIds, changed))).toBe(true);
  });
});

describe("容器级改动（现有模块完全未覆盖）", () => {
  it("标题变化", () => {
    const diff = buildStructuredDiff(base(), base(), { oldTitle: "旧标题", newTitle: "新标题" });
    expect(diff.container.title).toEqual({ before: "旧标题", after: "新标题" });
  });

  it("模板变化", () => {
    const diff = buildStructuredDiff(base(), base(), { oldTemplateId: "classic", newTemplateId: "modern" });
    expect(diff.container.templateId).toEqual({ before: "classic", after: "modern" });
  });

  it("标题未变时不产生条目", () => {
    const diff = buildStructuredDiff(base(), base(), { oldTitle: "同", newTitle: "同" });
    expect(diff.container.title).toBeUndefined();
  });

  it("sectionOrder 变化区分「重排」与「显示/隐藏」", () => {
    const after = base({ sectionOrder: ["basics", "projects", "experience"] });
    const diff = buildStructuredDiff(base(), after);
    expect(diff.container.sectionOrder).toBeDefined();
    // 两个模块都还在，只是顺序变了 → moved 列出位置变化的。
    expect(diff.container.sectionOrder?.moved.length).toBeGreaterThan(0);
  });

  it("隐藏模块（集合变化）不报 moved（那不是一个模块「移动」）", () => {
    const after = base({ sectionOrder: ["basics", "experience"] });
    const diff = buildStructuredDiff(base(), after);
    expect(diff.container.sectionOrder).toBeDefined();
    // projects 被移除，experience 位置未变 → moved 为空。
    expect(diff.container.sectionOrder?.moved).toEqual([]);
  });

  it("样式从「未设置」变为「已设置」时列出全部新增键", () => {
    /*
     * `styleSettings` 默认是 `undefined`（不是空对象），设置后包含完整键集。
     * 因此这里是「从无到有」，changedKeys 列出设置后的全部键 ——
     * 不是只有用户显式改的那两个。
     */
    const after = base({ styleSettings: { fontSize: 14, pagePadding: 40 } });
    const diff = buildStructuredDiff(base(), after);
    expect(diff.container.styleSettings).toBeDefined();
    expect(diff.container.styleSettings?.changedKeys).toContain("fontSize");
    expect(diff.container.styleSettings?.changedKeys).toContain("pagePadding");
  });

  it("两侧都已设置时只列出**真正不同**的键", () => {
    const before = base({ styleSettings: { fontSize: 12, pagePadding: 40, itemGap: 8 } });
    const after = base({ styleSettings: { fontSize: 14, pagePadding: 40, itemGap: 8 } });
    const diff = buildStructuredDiff(before, after);
    expect(diff.container.styleSettings?.changedKeys).toEqual(["fontSize"]);
  });

  it("样式相同 → 不产生 styleSettings 条目", () => {
    const style = { fontSize: 12, pagePadding: 40 };
    const diff = buildStructuredDiff(base({ styleSettings: style }), base({ styleSettings: style }));
    expect(diff.container.styleSettings).toBeUndefined();
  });

  it("单例富文本变化被检出", () => {
    const after = base({
      skills: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Go" }] }] },
    });
    const diff = buildStructuredDiff(base(), after);
    expect(diff.container.singletonRichText?.map((entry) => entry.field)).toContain("skills");
  });

  it("自定义模块的变化被检出（现有模块未覆盖 custom）", () => {
    const after = base({
      custom: [{ id: "sec-a", title: "开源贡献", content: { type: "doc", content: [] } }],
    });
    const diff = buildStructuredDiff(base(), after);
    const custom = diff.sections.find((section) => section.section === "custom");
    expect(custom?.changed).toBe(true);
    expect(custom?.items[0].status).toBe("added");
  });
});

describe("hasChanges", () => {
  it("完全相同 → false", () => {
    expect(buildStructuredDiff(base(), base()).hasChanges).toBe(false);
  });

  it("任一区块或容器变化 → true", () => {
    expect(buildStructuredDiff(base(), base({ sectionOrder: ["basics"] })).hasChanges).toBe(true);
    expect(
      buildStructuredDiff(base(), base(), { oldTitle: "a", newTitle: "b" }).hasChanges,
    ).toBe(true);
  });
});
