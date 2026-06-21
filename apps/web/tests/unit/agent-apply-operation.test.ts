import { describe, expect, it } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
import type { ResumeOperation } from "@intro-builder/shared/types";

import {
  applyResumeOperation,
  isAutoApplicableOperation,
} from "@/lib/agent/apply-operation";

function makeOp(partial: Partial<ResumeOperation>): ResumeOperation {
  return {
    id: "op_1",
    toolCallId: "tool_1",
    label: "测试",
    section: "experience",
    fieldPath: "experience.0.content",
    operation: "insert_section",
    beforePlainText: "（空）",
    afterPlainText: "内容",
    changeSummary: "新增",
    riskFlags: [],
    ...partial,
  };
}

const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };

function collectNodeTypes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current = typeof record.type === "string" ? [record.type] : [];
  const children = Array.isArray(record.content)
    ? record.content.flatMap((child) => collectNodeTypes(child))
    : [];
  return [...current, ...children];
}

function collectText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? record.text : "";
  const childText = Array.isArray(record.content)
    ? record.content.map((child) => collectText(child)).join("")
    : "";
  return ownText + childText;
}

describe("applyResumeOperation", () => {
  it("allows auto-apply only for low-risk update and insert operations", () => {
    expect(
      isAutoApplicableOperation(
        makeOp({ operation: "update_section", riskFlags: [] }),
      ),
    ).toBe(true);
    expect(
      isAutoApplicableOperation(
        makeOp({ operation: "insert_section", riskFlags: [] }),
      ),
    ).toBe(true);
    expect(
      isAutoApplicableOperation(
        makeOp({
          operation: "update_section",
          riskFlags: [
            {
              type: "possible_fabrication",
              message: "需要确认指标来源。",
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isAutoApplicableOperation(
        makeOp({ operation: "delete_section", riskFlags: [] }),
      ),
    ).toBe(false);
    expect(
      isAutoApplicableOperation(
        makeOp({ operation: "reorder_sections", sectionOrder: ["basics"] }),
      ),
    ).toBe(false);
  });

  it("creates a missing experience item with default fields and keeps it in order", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ fieldPath: "experience.0.content", replacementTiptapJson: doc }),
    );
    expect(result).not.toBeNull();
    expect(result!.content.experience).toHaveLength(1);
    expect(result!.content.experience[0].content).toEqual(doc);
    // default scalar fields exist so the editor/template don't crash
    expect(result!.content.experience[0].company).toBe("");
    expect(result!.content.experience[0].title).toBe("");
    expect(result!.content.sectionOrder).toContain("experience");
  });

  it("adds a non-default section (research) to sectionOrder", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "research", fieldPath: "research.0.content", replacementTiptapJson: doc }),
    );
    expect(result!.content.research).toHaveLength(1);
    expect(result!.content.sectionOrder).toContain("research");
    expect(result!.changedKeys).toContain("sectionOrder");
  });

  it("creates a custom section item with an id and registers that id in order", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "custom", fieldPath: "custom.0.content", replacementTiptapJson: doc }),
    );
    const item = result!.content.custom[0];
    expect(typeof item.id).toBe("string");
    expect(item.id.length).toBeGreaterThan(0);
    expect(result!.content.sectionOrder).toContain(item.id);
  });

  it("creates a custom section with title and content from one semantic operation", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        operation: "insert_section",
        section: "custom",
        fieldPath: "custom.0",
        replacementValue: { title: "开源贡献" },
        afterPlainText: "维护 3 个开源项目。",
        changeSummary: "新增开源贡献模块。",
      }),
    );
    const item = result!.content.custom[0];
    expect(item.title).toBe("开源贡献");
    expect(JSON.stringify(item.content)).toContain("维护 3 个开源项目。");
    expect(result!.content.sectionOrder).toContain(item.id);
  });

  it("updates a custom section title and content from one semantic operation", () => {
    const base = emptyResumeContent();
    base.custom = [{ id: "custom_1", title: "旧标题", content: doc }];
    base.sectionOrder = ["basics", "custom_1"];
    const result = applyResumeOperation(
      base,
      makeOp({
        operation: "update_section",
        section: "custom",
        fieldPath: "custom.custom_1",
        replacementValue: {
          title: "开源贡献",
          content: "维护 3 个开源项目。",
        },
        afterPlainText: "维护 3 个开源项目。",
        changeSummary: "更新自定义模块块。",
      }),
    );
    const item = result!.content.custom[0];
    expect(item.title).toBe("开源贡献");
    expect(JSON.stringify(item.content)).toContain("维护 3 个开源项目。");
    expect(result!.changedKeys).toEqual(["custom"]);
  });

  it("sets basics.summary as a string", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "summary", fieldPath: "basics.summary", afterPlainText: "三年后端经验" }),
    );
    expect(result!.content.basics.summary).toBe("三年后端经验");
    expect(result!.changedKeys).toEqual(["basics"]);
  });

  it("sets business scalar fields from basics without using generic paths in the UI layer", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "basics",
        fieldPath: "basics.name",
        afterPlainText: "李四",
        changeSummary: "更新候选人姓名。",
      }),
    );
    expect(result!.content.basics.name).toBe("李四");
    expect(result!.changedKeys).toEqual(["basics"]);
  });

  it("sets the candidate photo URL as a business basics field", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "basics",
        fieldPath: "basics.photo",
        afterPlainText: "https://example.com/avatar.jpg",
        changeSummary: "更新候选人头像。",
      }),
    );
    expect(result!.content.basics.photo).toBe("https://example.com/avatar.jpg");
    expect(result!.changedKeys).toEqual(["basics"]);
  });

  it("merges basics blocks generated by semantic tools", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "basics",
        fieldPath: "basics",
        operation: "update_section",
        replacementValue: {
          name: "李四",
          photo: "https://example.com/avatar.jpg",
          summary: "三年后端经验",
        },
        changeSummary: "更新基础信息块。",
      }),
    );
    expect(result!.content.basics).toEqual(
      expect.objectContaining({
        name: "李四",
        photo: "https://example.com/avatar.jpg",
        summary: "三年后端经验",
      }),
    );
    expect(result!.content.basics.title).toBe("前端工程师");
    expect(result!.changedKeys).toEqual(["basics"]);
  });

  it("sets the top-level skills TipTap field", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "skills", fieldPath: "skills", replacementTiptapJson: doc }),
    );
    expect(result!.content.skills).toEqual(doc);
  });

  it("parses HTML agent output into TipTap for top-level rich-text fields", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "skills",
        fieldPath: "skills",
        afterPlainText: "<ul><li><strong>前端开发</strong>：Vue、TypeScript</li></ul>",
      }),
    );

    expect(collectNodeTypes(result!.content.skills)).toContain("bulletList");
    expect(JSON.stringify(result!.content.skills)).toContain("\"type\":\"bold\"");
    expect(collectText(result!.content.skills)).toBe("前端开发：Vue、TypeScript");
    expect(collectText(result!.content.skills)).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it("repairs TipTap replacements whose text nodes still contain HTML tags", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "skills",
        fieldPath: "skills",
        afterPlainText: "<ul><li><strong>前端开发</strong>：Vue、TypeScript</li></ul>",
        replacementTiptapJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "<ul><li><strong>前端开发</strong>：Vue、TypeScript</li></ul>",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(collectNodeTypes(result!.content.skills)).toContain("bulletList");
    expect(collectText(result!.content.skills)).toBe("前端开发：Vue、TypeScript");
    expect(collectText(result!.content.skills)).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it("updates an existing array item in place without adding a new one", () => {
    const base = emptyResumeContent();
    base.experience = [{ company: "蜂鸟", title: "后端", start: "2021", end: "2024", location: "", content: { type: "doc", content: [] } }];
    const result = applyResumeOperation(
      base,
      makeOp({ operation: "update_section", fieldPath: "experience.0.content", replacementTiptapJson: doc }),
    );
    expect(result!.content.experience).toHaveLength(1);
    expect(result!.content.experience[0].company).toBe("蜂鸟"); // preserved
    expect(result!.content.experience[0].content).toEqual(doc);
  });

  it("updates array item metadata fields without rewriting rich text", () => {
    const base = emptyResumeContent();
    base.experience = [
      {
        company: "旧公司",
        title: "前端",
        start: "2021",
        end: "2024",
        location: "杭州",
        content: doc,
      },
    ];
    const result = applyResumeOperation(
      base,
      makeOp({
        operation: "update_section",
        section: "experience",
        fieldPath: "experience.0.company",
        afterPlainText: "新公司",
        changeSummary: "更新公司名称。",
      }),
    );
    expect(result!.content.experience[0].company).toBe("新公司");
    expect(result!.content.experience[0].content).toEqual(doc);
    expect(result!.changedKeys).toEqual(["experience"]);
  });

  it("merges array item blocks generated by semantic tools", () => {
    const base = emptyResumeContent();
    base.experience = [
      {
        company: "旧公司",
        title: "前端",
        start: "2021",
        end: "2024",
        location: "杭州",
        content: doc,
      },
    ];
    const result = applyResumeOperation(
      base,
      makeOp({
        operation: "update_section",
        section: "experience",
        fieldPath: "experience.0",
        replacementValue: {
          company: "字节跳动",
          title: "前端工程师",
          content: "主导增长平台搭建。",
        },
        afterPlainText: "主导增长平台搭建。",
        changeSummary: "更新工作经历块。",
      }),
    );
    expect(result!.content.experience[0]).toEqual(
      expect.objectContaining({
        company: "字节跳动",
        title: "前端工程师",
        start: "2021",
        end: "2024",
      }),
    );
    expect(result!.content.experience[0].content).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "主导增长平台搭建。" }],
        },
      ],
    });
    expect(result!.changedKeys).toEqual(["experience"]);
  });

  it("parses HTML agent output inside block-level rich-text replacements", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        operation: "insert_section",
        section: "projects",
        fieldPath: "projects.0",
        replacementValue: {
          name: "前端监控埋点平台",
          content: "<p><strong>项目描述：</strong>埋点监控系统</p><ul><li>支持 PV、UV 与错误捕获</li></ul>",
        },
        afterPlainText: "<p><strong>项目描述：</strong>埋点监控系统</p><ul><li>支持 PV、UV 与错误捕获</li></ul>",
        changeSummary: "更新项目经历块。",
      }),
    );

    const content = result!.content.projects[0].content;
    expect(collectNodeTypes(content)).toContain("bulletList");
    expect(JSON.stringify(content)).toContain("\"type\":\"bold\"");
    expect(collectText(content)).toContain("项目描述：埋点监控系统");
    expect(collectText(content)).toContain("支持 PV、UV 与错误捕获");
    expect(collectText(content)).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it("creates an array item with metadata and content from one semantic operation", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        operation: "insert_section",
        section: "experience",
        fieldPath: "experience.0",
        replacementValue: {
          company: "字节跳动",
          title: "前端工程师",
        },
        afterPlainText: "负责核心链路性能优化。",
        changeSummary: "新增工作经历。",
      }),
    );
    expect(result!.content.experience[0]).toEqual(
      expect.objectContaining({
        company: "字节跳动",
        title: "前端工程师",
      }),
    );
    expect(JSON.stringify(result!.content.experience[0].content)).toContain(
      "负责核心链路性能优化。",
    );
    expect(result!.content.sectionOrder).toContain("experience");
    expect(result!.changedKeys).toEqual(["experience"]);
  });

  it("updates bounded style settings values", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "style",
        fieldPath: "styleSettings.fontSize",
        operation: "update_section",
        afterPlainText: "12",
        replacementValue: 12,
        changeSummary: "调整正文字号。",
      }),
    );
    expect(result!.content.styleSettings?.fontSize).toBe(12);
    expect(result!.content.styleSettings?.fontFamily).toBe("sans");
    expect(result!.changedKeys).toEqual(["styleSettings"]);
  });

  it("merges style settings blocks generated by semantic tools", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "style",
        fieldPath: "styleSettings",
        operation: "update_section",
        replacementValue: {
          fontSize: 12,
          photoScale: 0.9,
        },
        changeSummary: "调整简历样式。",
      }),
    );
    expect(result!.content.styleSettings?.fontSize).toBe(12);
    expect(result!.content.styleSettings?.photoScale).toBe(0.9);
    expect(result!.content.styleSettings?.fontFamily).toBe("sans");
    expect(result!.changedKeys).toEqual(["styleSettings"]);
  });

  it("mirrors lineHeight when style block tools update the legacy line-height field", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({
        section: "style",
        fieldPath: "styleSettings",
        operation: "update_section",
        replacementValue: {
          lineHeight: 1.4,
        },
        changeSummary: "调整行高。",
      }),
    );
    expect(result!.content.styleSettings?.lineHeight).toBe(1.4);
    expect(result!.content.styleSettings?.bodyLineHeight).toBe(1.4);
    expect(result!.changedKeys).toEqual(["styleSettings"]);
  });

  it("replaces sectionOrder for reorder_sections", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ operation: "reorder_sections", sectionOrder: ["basics", "skills", "experience"] }),
    );
    expect(result!.content.sectionOrder).toEqual(["basics", "skills", "experience"]);
    expect(result!.changedKeys).toEqual(["sectionOrder"]);
  });

  it("hides a built-in module by removing it from sectionOrder", () => {
    const base = emptyResumeContent();
    base.sectionOrder = ["basics", "experience", "projects", "skills"];
    const result = applyResumeOperation(
      base,
      makeOp({
        operation: "delete_section",
        section: "projects",
        fieldPath: "projects",
        afterPlainText: "",
        changeSummary: "隐藏项目经历模块。",
      }),
    );
    expect(result!.content.sectionOrder).toEqual(["basics", "experience", "skills"]);
    expect(result!.changedKeys).toEqual(["sectionOrder"]);
  });

  it("deletes an array item and unregisters empty custom sections from order", () => {
    const base = emptyResumeContent();
    base.projects = [
      { name: "A", role: "", location: "", start: "", end: "", stack: [], link: "", content: doc },
      { name: "B", role: "", location: "", start: "", end: "", stack: [], link: "", content: doc },
    ];
    base.custom = [{ id: "custom_1", title: "补充", content: doc }];
    base.sectionOrder = ["basics", "projects", "custom_1"];

    const projectResult = applyResumeOperation(
      base,
      makeOp({
        operation: "delete_section",
        section: "projects",
        fieldPath: "projects.0",
        afterPlainText: "",
        changeSummary: "删除第一段项目经历。",
      }),
    );
    expect(projectResult!.content.projects.map((project) => project.name)).toEqual(["B"]);
    expect(projectResult!.content.sectionOrder).toContain("projects");

    const customResult = applyResumeOperation(
      base,
      makeOp({
        operation: "delete_section",
        section: "custom",
        fieldPath: "custom.custom_1",
        afterPlainText: "",
        changeSummary: "删除自定义模块。",
      }),
    );
    expect(customResult!.content.custom).toEqual([]);
    expect(customResult!.content.sectionOrder).toEqual(["basics", "projects"]);
  });

  it("updates custom section title and content by id", () => {
    const base = emptyResumeContent();
    base.custom = [{ id: "custom_1", title: "旧标题", content: doc }];
    base.sectionOrder = ["basics", "custom_1"];

    const titleResult = applyResumeOperation(
      base,
      makeOp({
        operation: "update_section",
        section: "custom",
        fieldPath: "custom.custom_1.title",
        afterPlainText: "开源贡献",
        changeSummary: "重命名自定义模块。",
      }),
    );
    expect(titleResult!.content.custom[0].title).toBe("开源贡献");

    const contentResult = applyResumeOperation(
      base,
      makeOp({
        operation: "update_section",
        section: "custom",
        fieldPath: "custom.custom_1.content",
        afterPlainText: "维护 3 个开源项目。",
        changeSummary: "更新自定义模块内容。",
      }),
    );
    expect(JSON.stringify(contentResult!.content.custom[0].content)).toContain(
      "维护 3 个开源项目。",
    );
  });

  it("reorders array items with explicit item order", () => {
    const base = emptyResumeContent();
    base.experience = [
      { company: "A", title: "", start: "", end: "", location: "", content: doc },
      { company: "B", title: "", start: "", end: "", location: "", content: doc },
      { company: "C", title: "", start: "", end: "", location: "", content: doc },
    ];

    const result = applyResumeOperation(
      base,
      makeOp({
        operation: "reorder_items",
        section: "experience",
        fieldPath: "experience",
        itemOrder: [2, 0, 1],
        changeSummary: "调整工作经历顺序。",
      }),
    );

    expect(result!.content.experience.map((item) => item.company)).toEqual(["C", "A", "B"]);
    expect(result!.changedKeys).toEqual(["experience"]);
  });

  it("reorders custom sections by id", () => {
    const base = emptyResumeContent();
    base.custom = [
      { id: "custom_1", title: "A", content: doc },
      { id: "custom_2", title: "B", content: doc },
    ];

    const result = applyResumeOperation(
      base,
      makeOp({
        operation: "reorder_items",
        section: "custom",
        fieldPath: "custom",
        itemOrder: ["custom_2", "custom_1"],
        afterPlainText: "custom_2,custom_1",
        changeSummary: "调整自定义模块顺序。",
      }),
    );

    expect(result!.content.custom.map((item) => item.id)).toEqual(["custom_2", "custom_1"]);
    expect(result!.changedKeys).toEqual(["custom"]);
  });

  it("returns null for unsupported field paths", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ operation: "delete_section", fieldPath: "experience.0", afterPlainText: "x" }),
    );
    expect(result).toBeNull();
  });
});
