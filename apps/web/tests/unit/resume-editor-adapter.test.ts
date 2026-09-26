import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE_SETTINGS,
  ResumeContent,
  SemanticOperation,
  emptyResumeContent,
  hashTargetValue,
} from "@intro-builder/shared/schemas";

import {
  buildApplyTemplateOperations,
  buildMutationOperations,
} from "@/lib/resume-mutations/editor-adapter";
import { prepareMutation } from "@/lib/resume-mutations/prepare";

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function base(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
      { id: "exp-b", company: "乙公司", title: "后端", start: "2021", end: "2022", location: "", content: doc("做乙") },
    ],
    projects: [
      { id: "proj-a", name: "项目一", role: "", location: "", start: "", end: "", stack: [], link: "", content: doc("内容") },
    ],
    sectionOrder: ["basics", "experience", "projects"],
  });
}

let opCounter = 0;
function newOpId() {
  opCounter += 1;
  return `op-${opCounter}`;
}

/** prepare（提交层）需要它兜底生成身份；适配器本身不生成身份。 */
const newItemId = () => "itm-generated";

function diff(baseline: ResumeContent, next: ResumeContent) {
  return buildMutationOperations({ baseline, next, newOpId });
}

/** 所有产出的操作都必须能通过命令契约。 */
function expectValid(operations: SemanticOperation[]) {
  for (const op of operations) {
    const parsed = SemanticOperation.safeParse(op);
    expect(parsed.success, `操作 ${op.kind} 不符合契约：${JSON.stringify(parsed.success ? "" : (parsed as { error: { issues: Array<{ message: string }> } }).error.issues)}`).toBe(true);
  }
}

describe("编辑器适配器：无变化", () => {
  it("内容相同时不产生任何操作（不会生成空修订）", () => {
    const content = base();
    const result = diff(content, ResumeContent.parse(content));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([]);
    expect(result.changedSections).toEqual([]);
  });

  it("仅对象引用不同但值相同 → 无操作", () => {
    const content = base();
    const cloned = ResumeContent.parse(JSON.parse(JSON.stringify(content)));
    const result = diff(content, cloned);
    if (!result.ok) throw new Error(result.message);
    expect(result.operations).toEqual([]);
  });
});

describe("编辑器适配器：字段编辑", () => {
  it("basics 字段变化产出带前置条件的 set_field", () => {
    const before = base();
    const after = ResumeContent.parse({ ...before, basics: { ...before.basics, name: "李四" } });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op.kind).toBe("set_field");
    if (op.kind !== "set_field") return;
    expect(op.target).toMatchObject({ section: "basics", field: "name" });
    expect(op.condition.expectedValueHash).toBe(hashTargetValue("张三"));
    expect(op.value).toBe("李四");
  });

  it("条目字段按稳定 ID 定位，而不是下标", () => {
    const before = base();
    const items = [...before.experience];
    items[1] = { ...items[1], company: "乙公司（改）" };
    const after = ResumeContent.parse({ ...before, experience: items });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    if (op.kind !== "set_field") throw new Error("expected set_field");
    expect(op.target).toMatchObject({ section: "experience", itemId: "exp-b", field: "company" });
  });

  it("TipTap 字段变化被捕获（education 用 highlights）", () => {
    const before = ResumeContent.parse({
      ...base(),
      education: [{ id: "edu-a", school: "S", degree: "", major: "", location: "", start: "", end: "", gpa: "", highlights: doc("旧") }],
    });
    const after = ResumeContent.parse({
      ...before,
      education: [{ ...before.education[0], highlights: doc("新") }],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    const op = result.operations[0];
    if (op.kind !== "set_field") throw new Error("expected set_field");
    expect(op.target).toMatchObject({ section: "education", itemId: "edu-a", field: "highlights" });
  });

  it("单例 TipTap 区块（skills）被捕获，且定位是整个 section", () => {
    const before = base();
    const after = ResumeContent.parse({ ...before, skills: doc("新技能") });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    expect(result.operations[0].kind).toBe("set_field");
    if (result.operations[0].kind !== "set_field") return;
    /*
     * 单例区块的值**就是** TipTap doc，所以目标是整个 section（不带 field）。
     * 此前的断言期待 `field: "content"`，那是错的：它让 prepare 去读 doc 内层的
     * `content` 数组，与 adapter 哈希的整个 doc 永不相等 —— 实测这四个模块全废。
     */
    expect(result.operations[0].target).toEqual({ section: "skills" });
  });
});

describe("编辑器适配器：增删排序", () => {
  it("新增条目产出 insert_item，带锚点与顺序哈希", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      experience: [
        ...before.experience,
        { id: "exp-new", company: "丙公司", title: "", start: "", end: "", location: "", content: doc("做丙") },
      ],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    const insert = result.operations.find((op) => op.kind === "insert_item");
    expect(insert).toBeDefined();
    if (insert?.kind !== "insert_item") return;
    expect(insert.itemId).toBe("exp-new");
    expect(insert.afterItemId).toBe("exp-b");
    expect(insert.expectedOrderHash).toBe(hashTargetValue(["exp-a", "exp-b"]));
  });

  it("插到最前时锚点为 null", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      experience: [
        { id: "exp-new", company: "新", title: "", start: "", end: "", location: "", content: doc("") },
        ...before.experience,
      ],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    const insert = result.operations.find((op) => op.kind === "insert_item");
    if (insert?.kind !== "insert_item") throw new Error("expected insert_item");
    expect(insert.afterItemId).toBeNull();
  });

  it("删除条目产出 delete_item，条件是整条内容", () => {
    const before = base();
    const after = ResumeContent.parse({ ...before, experience: [before.experience[0]] });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    const del = result.operations.find((op) => op.kind === "delete_item");
    if (del?.kind !== "delete_item") throw new Error("expected delete_item");
    expect(del.target).toMatchObject({ section: "experience", itemId: "exp-b" });
    // 删除的前置条件是「整条」而非单个字段。
    expect(del.condition.expectedValueHash).toBe(hashTargetValue(before.experience[1]));
  });

  it("仅交换位置产出 reorder_items，**不**产出两条全文改写", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      experience: [before.experience[1], before.experience[0]],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    expect(result.operations).toHaveLength(1);
    const reorder = result.operations[0];
    if (reorder.kind !== "reorder_items") throw new Error("expected reorder_items");
    expect(reorder.beforeIds).toEqual(["exp-a", "exp-b"]);
    expect(reorder.afterIds).toEqual(["exp-b", "exp-a"]);
  });

  it("同时改字段与排序时产出两类操作", () => {
    const before = base();
    const reordered = [before.experience[1], before.experience[0]];
    const after = ResumeContent.parse({
      ...before,
      experience: [{ ...reordered[0], company: "乙改" }, reordered[1]],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    const kinds = result.operations.map((op) => op.kind).sort();
    expect(kinds).toEqual(["reorder_items", "set_field"]);
  });

  it("新增 + 删除混合时不会误报重排", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      experience: [
        { id: "exp-b", ...before.experience[1] },
        { id: "exp-new", company: "新", title: "", start: "", end: "", location: "", content: doc("") },
      ],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    // 删了 A、插了新条目；幸存者只剩 B，不存在需要重排的幸存者序列。
    expect(result.operations.some((op) => op.kind === "delete_item")).toBe(true);
    expect(result.operations.some((op) => op.kind === "insert_item")).toBe(true);
  });
});

describe("编辑器适配器：模块顺序、样式、行级字段", () => {
  it("sectionOrder 变化产出 set_section_order", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      sectionOrder: ["experience", "basics", "projects"],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    expect(result.operations[0].kind).toBe("set_section_order");
  });

  it("样式变化产出 set_style，只含变化的键", () => {
    const before = ResumeContent.parse({
      ...base(),
      styleSettings: { ...emptyResumeContent().basics, fontSize: 13, fontFamily: "sans" } as never,
    });
    const after = ResumeContent.parse({
      ...before,
      styleSettings: { ...(before.styleSettings ?? {}), fontSize: 12 },
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    const style = result.operations.find((op) => op.kind === "set_style");
    if (style?.kind !== "set_style") throw new Error("expected set_style");
    expect(style.patch).toEqual({ fontSize: 12 });
  });

  it("【复核发现】应用模板可产出 set_template + set_style（模板库走同一通道）", () => {
    /*
     * 旧 `setTemplate` action 不带 revision、不写 mutation 留痕，还默认整体覆盖
     * styleSettings —— 与编辑器并发时两边互相覆盖。模板库现在走
     * `buildApplyTemplateOperations` + 统一提交。
     * 这里锁住「换模板 + 重置排版」确实产出两条操作（行级 + 内容级）。
     */
    const content = base();
    let n = 0;
    const noReset = buildApplyTemplateOperations({
      baseline: content,
      baselineTemplateId: "classic",
      nextTemplateId: "modern",
      templateStyle: null,
      newOpId: () => `op-${++n}`,
    });
    // 只换模板：不产生内容级操作（保留用户调好的排版）。
    expect(noReset.operations.map((op) => op.kind)).toEqual(["set_template"]);

    n = 0;
    const withReset = buildApplyTemplateOperations({
      baseline: content,
      baselineTemplateId: "classic",
      nextTemplateId: "modern",
      templateStyle: { fontSize: 12, pagePadding: 32 },
      newOpId: () => `op-${++n}`,
    });
    // 换模板 + 重置排版：排版属于 content，因此额外一条 set_style。
    expect(withReset.operations.map((op) => op.kind).sort()).toEqual(["set_style", "set_template"]);

    const prepared = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: withReset.operations,
      newItemId,
      resumeRow: { title: "", templateId: "classic" },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.rowPatch.templateId).toBe("modern");
    expect(prepared.nextContent.styleSettings?.fontSize).toBe(12);
    // 正文内容不得被换模板改动。
    expect(prepared.nextContent.experience).toEqual(content.experience);
  });

  it("标题与模板作为行级字段产出 set_title / set_template", () => {
    const content = base();
    const result = buildMutationOperations({
      baseline: content,
      next: content,
      newOpId,
      baselineRow: { title: "旧标题", templateId: "classic" },
      nextRow: { title: "新标题", templateId: "modern" },
    });
    if (!result.ok) throw new Error(result.message);
    expectValid(result.operations);
    const kinds = result.operations.map((op) => op.kind).sort();
    expect(kinds).toEqual(["set_template", "set_title"]);
    // 行级字段不得进入 content 的 content 层。
    expect(result.changedSections).toContain("title");
    expect(result.changedSections).toContain("templateId");
  });
});

describe("【独立复核发现】单例富文本与样式", () => {
  it("四个单例富文本区块都能提交（此前全部 condition_mismatch）", () => {
    /*
     * 真实缺陷：adapter 产出 `target:{section:"summary",field:"content"}` 且哈希
     * 整个 doc，而 prepare 走 `field !== undefined` 分支去读 doc 内层的 `content`，
     * 两者永不相等 —— summary/skills/awards/portfolio 的编辑**永远**失败。
     * 单例区块的值就是 doc 本身，定位应当是整个 section（不带 field）。
     */
    for (const section of ["summary", "skills", "awards", "portfolio"] as const) {
      const before = ResumeContent.parse({
        ...emptyResumeContent(),
        [section]: doc("旧内容"),
        sectionOrder: ["basics", section],
      });
      const after = ResumeContent.parse({ ...before, [section]: doc("新内容") });
      const result = diff(before, after);
      if (!result.ok) throw new Error(`${section}: ${result.message}`);
      expect(result.operations, section).toHaveLength(1);

      const prepared = prepareMutation({
        content: before,
        currentRevision: 0,
        expectedRevision: 0,
        operations: result.operations,
        newItemId,
        resumeRow: { title: "", templateId: "" },
      });
      expect(prepared.ok, `${section} 应能提交`).toBe(true);
      if (!prepared.ok) continue;
      expect(prepared.nextContent[section], section).toEqual(doc("新内容"));
    }
  });

  it("新建简历（无 styleSettings）首次改样式不崩溃且能提交", () => {
    /*
     * 真实缺陷：`emptyResumeContent()` 不含 styleSettings，于是
     * `beforeStyle[key]` 为 undefined → `hashValue(undefined)` 抛
     * `Cannot read properties of undefined (reading 'length')`。
     * 崩溃点不在任何 try/catch 内，会让保存状态永久卡在 pending，
     * 之后连正文也存不上 —— 一次样式改动毒化整份文档。
     */
    const before = emptyResumeContent();
    expect("styleSettings" in before).toBe(false);

    const after = ResumeContent.parse({
      ...before,
      styleSettings: { ...DEFAULT_STYLE_SETTINGS, fontSize: 12 },
    });
    const result = diff(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const prepared = prepareMutation({
      content: before,
      currentRevision: 0,
      expectedRevision: 0,
      operations: result.operations,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.nextContent.styleSettings?.fontSize).toBe(12);
  });

  it("样式 patch 的每个键都带前置值（否则提交层会因缺条件拒绝）", () => {
    const before = emptyResumeContent();
    const after = ResumeContent.parse({
      ...before,
      styleSettings: { ...DEFAULT_STYLE_SETTINGS, fontSize: 12 },
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);
    const styleOp = result.operations.find((op) => op.kind === "set_style");
    if (styleOp?.kind !== "set_style") throw new Error("expected set_style");
    for (const key of Object.keys(styleOp.patch)) {
      expect(Object.keys(styleOp.before), `样式键 ${key} 缺少前置值`).toContain(key);
    }
  });
});

describe("【独立复核发现】同一批次内的顺序推演", () => {
  /**
   * 真实缺陷：同一去抖窗口内多次增删排时，每条操作都携带**同一份** baseline
   * 顺序条件，而 prepare 逐条比对「执行到它之前」的列表，于是第二条必然失败。
   * 触发场景都很常见：2 秒内连点两次「+ 添加」、新增后立刻拖拽排序。
   */
  function twoItemBase(): ResumeContent {
    return ResumeContent.parse({
      ...emptyResumeContent(),
      experience: [
        { id: "exp-a", company: "甲", title: "", start: "", end: "", location: "", content: doc("a") },
        { id: "exp-b", company: "乙", title: "", start: "", end: "", location: "", content: doc("b") },
      ],
      sectionOrder: ["basics", "experience"],
    });
  }

  function item(id: string, company: string) {
    return { id, company, title: "", start: "", end: "", location: "", content: doc(company) };
  }

  function commit(baseline: ResumeContent, next: ResumeContent) {
    const result = diff(baseline, next);
    if (!result.ok) throw new Error(result.message);
    const prepared = prepareMutation({
      content: baseline,
      currentRevision: 0,
      expectedRevision: 0,
      operations: result.operations,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!prepared.ok) throw new Error(`${prepared.code}: ${prepared.message}`);
    return (prepared.nextContent.experience as Array<{ id: string }>).map((e) => e.id).join(",");
  }

  it("一次去抖窗口内新增两条都能落盘", () => {
    const before = twoItemBase();
    const after = ResumeContent.parse({
      ...before,
      experience: [...before.experience, item("n1", "丙"), item("n2", "丁")],
    });
    expect(commit(before, after)).toBe("exp-a,exp-b,n1,n2");
  });

  it("新增 + 重排能落盘（此前误判冲突）", () => {
    const before = twoItemBase();
    const after = ResumeContent.parse({
      ...before,
      experience: [item("n1", "丙"), before.experience[1], before.experience[0]],
    });
    expect(commit(before, after)).toBe("n1,exp-b,exp-a");
  });

  it("新增 + 删除能落盘（删除先于/后于插入执行都不出错）", () => {
    const before = twoItemBase();
    const after = ResumeContent.parse({
      ...before,
      experience: [before.experience[1], item("n1", "丙")],
    });
    expect(commit(before, after)).toBe("exp-b,n1");
  });

  it("删空后新增也能落盘", () => {
    const before = twoItemBase();
    const after = ResumeContent.parse({ ...before, experience: [item("n1", "丙")] });
    expect(commit(before, after)).toBe("n1");
  });

  it("改字段 + 重排能落盘", () => {
    const before = twoItemBase();
    const after = ResumeContent.parse({
      ...before,
      experience: [{ ...before.experience[1], company: "乙改" }, before.experience[0]],
    });
    expect(commit(before, after)).toBe("exp-b,exp-a");
  });
});

describe("编辑器适配器：拒绝不安全输入", () => {
  it("条目缺稳定 ID 时拒绝，不回退到下标", () => {
    const legacy = ResumeContent.parse({
      ...base(),
      experience: [
        { company: "甲公司", title: "", start: "", end: "", location: "", content: doc("") },
      ],
    });
    const after = ResumeContent.parse({
      ...legacy,
      experience: [{ ...legacy.experience[0], company: "甲公司（改）" }],
    });
    const result = diff(legacy, after);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("needs_identity");
  });

  it("出现重复条目 ID 时拒绝（无法定位）", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      experience: [
        { ...before.experience[0], id: "dup" },
        { ...before.experience[1], id: "dup" },
      ],
    });
    const result = diff(before, after);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_structure");
  });
});

describe("端到端：适配器 → prepare → 提交命令", () => {
  it("适配器产出的操作能直接被 prepare 应用，结果等于目标内容", () => {
    const before = base();
    const after = ResumeContent.parse({
      ...before,
      basics: { ...before.basics, name: "李四" },
      experience: [
        before.experience[1],
        { ...before.experience[0], company: "甲公司（改）" },
      ],
      sectionOrder: ["basics", "experience", "projects"],
    });

    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);

    const prepared = prepareMutation({
      content: before,
      currentRevision: 0,
      expectedRevision: 0,
      operations: result.operations,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!prepared.ok) throw new Error(prepared.message);

    // 这一条是整个 P03 的关键保证：编辑器算出的命令重放到服务端基准上，
    // 得到的就应该是用户看到的那份内容。
    expect(prepared.nextContent.basics.name).toBe("李四");
    expect(prepared.nextContent.experience.map((e) => e.id)).toEqual(["exp-b", "exp-a"]);
    expect(prepared.nextContent.experience[1].company).toBe("甲公司（改）");
  });

  it("A/B 重排后旧提案仍改到原来的条目（F03 防线在编辑器层也成立）", () => {
    const before = base();
    // 用户改了 B 的 company，同时把两条交换位置。
    const after = ResumeContent.parse({
      ...before,
      experience: [
        { ...before.experience[1], company: "乙公司（改）" },
        before.experience[0],
      ],
    });
    const result = diff(before, after);
    if (!result.ok) throw new Error(result.message);

    // 服务端按「重排已发生」的基准执行（模拟竞态：先重排再应用）。
    const reorderedBaseline = ResumeContent.parse({
      ...before,
      experience: [before.experience[1], before.experience[0]],
    });
    const prepared = prepareMutation({
      content: reorderedBaseline,
      currentRevision: 0,
      expectedRevision: 0,
      operations: result.operations,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });

    // 顺序操作的 beforeIds 与当前不符 → 明确冲突，而不是把建议写错条目。
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.code).toBe("order_mismatch");
  });
});
