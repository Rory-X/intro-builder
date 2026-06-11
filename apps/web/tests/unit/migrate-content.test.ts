import { describe, it, expect } from "vitest";
import { migrateContent } from "@/lib/migrate-content";

describe("migrateContent", () => {
  it("returns v2 unchanged when content field exists on experience", () => {
    const v2 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "" },
      experience: [{ company: "X", title: "Y", start: "", end: "", location: "", content: { type: "doc", content: [] } }],
      education: [],
      projects: [],
      skills: [],
      custom: [],
      sectionOrder: ["basics"],
    };
    const result = migrateContent(v2);
    expect(result.experience[0].content).toEqual({ type: "doc", content: [] });
  });

  it("migrates v1 bullets to TipTap doc", () => {
    const v1 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "" },
      experience: [{ company: "X", title: "Y", start: "", end: "", location: "", bullets: ["did A", "did B"] }],
      education: [{ school: "S", degree: "", major: "", start: "", end: "", gpa: "", highlights: ["top student"] }],
      projects: [{ name: "P", stack: [], link: "", bullets: ["built it"] }],
      skills: [],
      custom: [],
    };
    const result = migrateContent(v1);
    expect(result.experience[0].content.type).toBe("doc");
    expect(result.experience[0].content.content[0].type).toBe("bulletList");
    expect(result.education[0].highlights.type).toBe("doc");
    expect(result.projects[0].content.type).toBe("doc");
    expect(result.sectionOrder).toBeDefined();
    expect(result.sectionOrder.length).toBeGreaterThan(0);
  });

  it("adds sectionOrder if missing", () => {
    const v1 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "" },
      experience: [],
      education: [],
      projects: [],
      skills: [],
      custom: [],
    };
    const result = migrateContent(v1);
    expect(result.sectionOrder).toEqual(["basics", "experience", "education", "projects", "skills"]);
  });

  it("preserves photo field if present", () => {
    const v2 = {
      basics: { name: "A", title: "", email: "a@b.com", phone: "", location: "", website: "", summary: "", photo: "https://example.com/pic.jpg" },
      experience: [],
      education: [],
      projects: [],
      skills: [],
      custom: [],
      sectionOrder: ["basics"],
    };
    const result = migrateContent(v2);
    expect(result.basics.photo).toBe("https://example.com/pic.jpg");
  });
});

describe("migrateContent — 个人总结/荣誉奖项/作品集 提升为一等公民", () => {
  const doc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("把 custom[] 里的 summary/awards/portfolio 搬到顶层字段并从 custom 移除", () => {
    const legacy = {
      basics: { name: "张三" },
      custom: [
        { id: "summary", title: "个人总结", content: doc("六年经验") },
        { id: "awards", title: "荣誉奖项", content: doc("国奖") },
        { id: "portfolio", title: "作品集", content: doc("作品X") },
        { id: "custom_123", title: "到那时", content: doc("自建内容") },
      ],
      sectionOrder: ["basics", "summary", "awards", "portfolio", "custom_123"],
    };
    const r = migrateContent(legacy);
    // 三个搬到顶层
    expect(r.summary).toEqual(doc("六年经验"));
    expect(r.awards).toEqual(doc("国奖"));
    expect(r.portfolio).toEqual(doc("作品X"));
    // 从 custom[] 移除，但用户自建的保留
    expect(r.custom.map((c) => c.id)).toEqual(["custom_123"]);
    // sectionOrder 原样保留（含三个 id + 自建）
    expect(r.sectionOrder).toEqual(["basics", "summary", "awards", "portfolio", "custom_123"]);
  });

  it("幂等：已是顶层字段的新数据不被 custom 旧值覆盖，再跑一次不变", () => {
    const migrated = {
      basics: { name: "李四" },
      summary: doc("新版总结"),
      custom: [],
      sectionOrder: ["basics", "summary"],
    };
    const once = migrateContent(migrated);
    expect(once.summary).toEqual(doc("新版总结"));
    expect(once.custom).toEqual([]);
    // 再跑一次（幂等）
    const twice = migrateContent(once);
    expect(twice.summary).toEqual(doc("新版总结"));
    expect(twice.custom).toEqual([]);
  });

  it("顶层已有内容时，不被 custom[] 里的同 id 旧值覆盖", () => {
    const conflict = {
      basics: { name: "王五" },
      summary: doc("顶层优先"),
      custom: [{ id: "summary", title: "个人总结", content: doc("旧的custom") }],
      sectionOrder: ["basics", "summary"],
    };
    const r = migrateContent(conflict);
    expect(r.summary).toEqual(doc("顶层优先"));
    expect(r.custom).toEqual([]);
  });
});
