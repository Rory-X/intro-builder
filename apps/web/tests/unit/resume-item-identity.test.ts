import { describe, it, expect } from "vitest";
import { ResumeContent, emptyResumeContent } from "@intro-builder/shared/schemas";
import { migrateContent } from "@intro-builder/shared/utils";

import {
  IDENTITY_SECTIONS,
  initializeItemIdentities,
} from "@/lib/resume-mutations/identity";

function legacyContent() {
  return {
    basics: { name: "张三", title: "", email: "", phone: "", location: "", website: "", summary: "" },
    experience: [
      { company: "A 公司", title: "前端", start: "2020", end: "2021", location: "", content: { type: "doc", content: [] } },
      { company: "B 公司", title: "后端", start: "2021", end: "2022", location: "", content: { type: "doc", content: [] } },
    ],
    education: [{ school: "S 大学", degree: "本科", major: "", location: "", start: "", end: "", gpa: "", highlights: { type: "doc", content: [] } }],
    projects: [{ name: "P", role: "owner", location: "", start: "", end: "", stack: ["ts"], link: "", content: { type: "doc", content: [] } }],
    research: [{ name: "R", role: "", location: "", start: "", end: "", paperTitle: "", link: "", content: { type: "doc", content: [] } }],
    skills: { type: "doc", content: [] },
    custom: [{ id: "custom_0", title: "自定义", content: { type: "doc", content: [] } }],
    sectionOrder: ["basics", "experience", "education", "projects", "skills", "custom_0"],
  };
}

describe("条目身份：读取兼容", () => {
  it("旧文档没有 ID 时仍可读，且 parse 不凭空生成 ID", () => {
    const parsed = ResumeContent.parse(legacyContent());
    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience[0].id).toBeUndefined();
    expect(parsed.education[0].id).toBeUndefined();
    expect(parsed.projects[0].id).toBeUndefined();
    expect(parsed.research[0].id).toBeUndefined();
  });

  it("经 migrateContent 的旧文档同样不生成 ID", () => {
    const migrated = migrateContent(legacyContent());
    expect(migrated.experience[0].id).toBeUndefined();
  });

  it("带 ID 的条目多次 parse 保持同一个 ID", () => {
    const content = legacyContent();
    const withIds = {
      ...content,
      experience: content.experience.map((e, i) => ({ ...e, id: `exp-${i}` })),
    };
    const once = ResumeContent.parse(withIds);
    const twice = ResumeContent.parse(once);
    expect(once.experience.map((e) => e.id)).toEqual(["exp-0", "exp-1"]);
    expect(twice.experience.map((e) => e.id)).toEqual(["exp-0", "exp-1"]);
  });

  it("重排只改变顺序，不改变 ID", () => {
    const content = ResumeContent.parse({
      ...legacyContent(),
      experience: [
        { ...legacyContent().experience[0], id: "exp-0" },
        { ...legacyContent().experience[1], id: "exp-1" },
      ],
    });
    const reordered = {
      ...content,
      experience: [content.experience[1], content.experience[0]],
    };
    const parsed = ResumeContent.parse(reordered);
    expect(parsed.experience.map((e) => e.id)).toEqual(["exp-1", "exp-0"]);
    expect(parsed.experience[0].company).toBe("B 公司");
  });

  it("custom 的既有 ID 不被重写", () => {
    const parsed = ResumeContent.parse(legacyContent());
    expect(parsed.custom[0].id).toBe("custom_0");
  });
});

describe("条目身份：一次性初始化（纯计算）", () => {
  it("为缺失 ID 的条目补齐身份，并标记 changed", () => {
    const result = initializeItemIdentities({
      resumeId: "resume-1",
      content: ResumeContent.parse(legacyContent()),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    for (const section of IDENTITY_SECTIONS) {
      for (const item of result.content[section]) {
        expect(typeof item.id).toBe("string");
        expect((item.id as string).length).toBeGreaterThan(0);
      }
    }
    expect(result.content.custom[0].id).toBe("custom_0");
  });

  it("重复调用结果完全一致（幂等）", () => {
    const input = { resumeId: "resume-1", content: ResumeContent.parse(legacyContent()) };
    const first = initializeItemIdentities(input);
    const second = initializeItemIdentities(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.content).toEqual(first.content);
    expect(second.assigned).toEqual(first.assigned);
  });

  it("已全部有 ID 的内容返回 changed=false 且不产生新 ID", () => {
    const first = initializeItemIdentities({
      resumeId: "resume-1",
      content: ResumeContent.parse(legacyContent()),
    });
    if (!first.ok) throw new Error("expected ok");
    const second = initializeItemIdentities({ resumeId: "resume-1", content: first.content });
    if (!second.ok) throw new Error("expected ok");
    expect(second.changed).toBe(false);
    expect(second.content).toEqual(first.content);
    expect(second.assigned).toEqual([]);
  });

  it("不改变文案与顺序", () => {
    const before = ResumeContent.parse(legacyContent());
    const result = initializeItemIdentities({ resumeId: "resume-1", content: before });
    if (!result.ok) throw new Error("expected ok");
    expect(result.content.experience.map((e) => e.company)).toEqual(before.experience.map((e) => e.company));
    expect(result.content.sectionOrder).toEqual(before.sectionOrder);
    expect(result.content.experience[0].content).toEqual(before.experience[0].content);
  });

  it("内容是同一份但位置不同时，两份复制得到不同 ID", () => {
    const base = ResumeContent.parse(legacyContent());
    const duplicated = ResumeContent.parse({
      ...base,
      experience: [base.experience[0], { ...base.experience[0] }],
    });
    const result = initializeItemIdentities({ resumeId: "resume-1", content: duplicated });
    if (!result.ok) throw new Error("expected ok");
    const ids = result.content.experience.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("不同简历的同一份旧内容得到不同 ID（不会跨简历撞号）", () => {
    const content = ResumeContent.parse(legacyContent());
    const a = initializeItemIdentities({ resumeId: "resume-a", content });
    const b = initializeItemIdentities({ resumeId: "resume-b", content });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.content.experience[0].id).not.toBe(b.content.experience[0].id);
  });

  it("拒绝同一条目数组内的重复 ID，并明确指出位置", () => {
    const content = ResumeContent.parse({
      ...legacyContent(),
      experience: [
        { ...legacyContent().experience[0], id: "dup" },
        { ...legacyContent().experience[1], id: "dup" },
      ],
    });
    const result = initializeItemIdentities({ resumeId: "resume-1", content });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate_item_id");
    expect(result.section).toBe("experience");
    expect(result.itemId).toBe("dup");
  });
});

describe("条目身份：契约表层", () => {
  it("IDENTITY_SECTIONS 覆盖全部数组 section，且不含单例 section", () => {
    expect([...IDENTITY_SECTIONS].sort()).toEqual(["education", "experience", "projects", "research"]);
  });

  it("空简历初始化返回 changed=false", () => {
    const result = initializeItemIdentities({ resumeId: "r", content: emptyResumeContent() });
    if (!result.ok) throw new Error("expected ok");
    expect(result.changed).toBe(false);
  });
});

describe("条目 ID 创建入口", () => {
  it("createItemId 每次都产生新 ID", async () => {
    const { createItemId } = await import("@/lib/resume-mutations/item-id");
    const ids = new Set(Array.from({ length: 200 }, () => createItemId()));
    expect(ids.size).toBe(200);
  });

  it("withItemId 给条目带上 ID 且不改动原字段", async () => {
    const { withItemId } = await import("@/lib/resume-mutations/item-id");
    const item = withItemId({ company: "甲公司", title: "前端" });
    expect(item.company).toBe("甲公司");
    expect(typeof item.id).toBe("string");
    expect(item.id.length).toBeGreaterThan(0);
  });

  it("withFreshItemIds 为导入的新文档补齐全部数组区块", async () => {
    const { withFreshItemIds } = await import("@/lib/resume-mutations/item-id");
    const content = ResumeContent.parse(legacyContent());
    const filled = withFreshItemIds(content as unknown as Record<string, unknown>) as unknown as ResumeContent;
    for (const section of ["experience", "education", "projects", "research"] as const) {
      for (const item of filled[section]) {
        expect(typeof (item as { id?: string }).id).toBe("string");
      }
    }
    // custom 已经自带 ID，不应被改写。
    expect(filled.custom[0].id).toBe("custom_0");
  });

  it("复制文档时 force 会重新分配身份（副本不共享源身份）", async () => {
    const { withFreshItemIds } = await import("@/lib/resume-mutations/item-id");
    const source = ResumeContent.parse({
      ...legacyContent(),
      experience: [{ ...legacyContent().experience[0], id: "源ID" }],
    });
    const copy = withFreshItemIds(
      source as unknown as Record<string, unknown>,
      { force: true },
    ) as unknown as ResumeContent;
    expect(copy.experience[0].id).not.toBe("源ID");
    // 源文档未被就地修改。
    expect(source.experience[0].id).toBe("源ID");
  });

  it("withFreshItemIds 保留已有 ID（非 force）", async () => {
    const { withFreshItemIds } = await import("@/lib/resume-mutations/item-id");
    const source = ResumeContent.parse({
      ...legacyContent(),
      experience: [{ ...legacyContent().experience[0], id: "已有的" }],
    });
    const filled = withFreshItemIds(
      source as unknown as Record<string, unknown>,
    ) as unknown as ResumeContent;
    expect(filled.experience[0].id).toBe("已有的");
  });
});
