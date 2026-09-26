import { describe, expect, it } from "vitest";

import { decidePolishApply } from "@/lib/resume-mutations/polish-guard";

function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("润色应用守卫", () => {
  it("原文未变时允许应用，并优先使用结构化替换", () => {
    const source = doc("负责订单系统开发");
    const decision = decidePolishApply(
      {
        originalText: "负责订单系统开发",
        originalTiptapJson: source,
        polishedText: "负责订单查询接口开发",
        replacementTiptapJson: doc("负责订单查询接口开发"),
      },
      source,
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.useStructured).toBe(true);
  });

  it("没有结构化替换时退回由文本重建", () => {
    const source = doc("原文");
    const decision = decidePolishApply(
      { originalText: "原文", originalTiptapJson: source, polishedText: "润色后" },
      source,
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.useStructured).toBe(false);
  });

  it("用户在查看建议期间改了这段文字 → 拒绝应用（不覆盖用户输入）", () => {
    const decision = decidePolishApply(
      {
        originalText: "负责订单系统开发",
        originalTiptapJson: doc("负责订单系统开发"),
        polishedText: "负责订单查询接口开发",
      },
      // 用户自己改过了
      doc("我改成了自己写的描述"),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("source_changed");
    // 提示必须让用户知道怎么继续，而不是只说「失败」。
    expect(decision.message).toContain("重新生成");
  });

  it("纯文本相同但结构不同（格式丢失）也算已变化", () => {
    const original = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "做甲" }] }] },
          ],
        },
      ],
    };
    // 同样的文字，但变成普通段落（用户或协作改动导致结构变化）
    const restructured = doc("做甲");

    const decision = decidePolishApply(
      { originalText: "做甲", originalTiptapJson: original, polishedText: "完成了甲" },
      restructured,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("source_changed");
  });

  it("候选内容为空时拒绝", () => {
    const source = doc("原文");
    const decision = decidePolishApply(
      { originalText: "原文", originalTiptapJson: source, polishedText: "" },
      source,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("empty_candidate");
  });

  it("原文为空的候选（例如新建空条目）按未变化处理并可应用", () => {
    const empty = doc("");
    const decision = decidePolishApply(
      { originalText: "", originalTiptapJson: empty, polishedText: "新增描述" },
      empty,
    );
    expect(decision.ok).toBe(true);
  });
});
