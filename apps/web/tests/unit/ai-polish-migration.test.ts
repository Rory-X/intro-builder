import { describe, expect, it } from "vitest";

import {
  extractTipTapTextBlocks,
  parsePolishProviderResponse,
  validateRichTextPolishRequest,
  type RichTextPolishRequest,
} from "@/lib/ai/capabilities/polish";
import { buildPolishPrompt } from "@/lib/ai/capabilities/polish-prompt";
import { CORE_V1 } from "@/lib/ai/prompts/core";

/**
 * 润色纯逻辑的迁移契约（P05 任务 4）。
 *
 * 这些函数逐字移植自 `apps/agent/src/rich-text-polish.ts`。迁移的正确判据是
 * **行为一致**，因此下面的 TipTap fixture 与断言刻意取自微服务侧的既有测试
 * （`apps/agent/tests/rich-text-polish.test.ts`），用同一份输入验证同一份预期。
 *
 * 最容易在迁移中丢失、且丢失后不报错的三条：
 *
 * 1. **粗体标签保留**。`项目描述：` 这种「短标签 + 冒号 + 粗体」结构若被整体重写，
 *    加粗格式就没了 —— 用户看到的是「格式怎么会丢了」。
 * 2. **块数必须严格一致**。数量不符时整体拒绝，而不是按下标硬套（那会把内容写错位置）。
 * 3. **解析失败要保留原因**。只回「润色失败」会让排查无从下手。
 */

/** 取自微服务测试的 fixture（含粗体标签、嵌套 bulletList、attrs）。 */
const TIPTAP_FIXTURE = {
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          attrs: { textAlign: "left" },
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: "left" },
              content: [
                { type: "text", marks: [{ type: "bold" }], text: "项目描述：" },
                { type: "text", text: "负责企业内部部门管理系统的前后端开发。" },
              ],
            },
          ],
        },
        {
          type: "listItem",
          attrs: { textAlign: "left" },
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: "left" },
              content: [{ type: "text", marks: [{ type: "bold" }], text: "项目难点：" }],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  attrs: { textAlign: "left" },
                  content: [
                    {
                      type: "paragraph",
                      attrs: { textAlign: "left" },
                      content: [{ type: "text", text: "登录请求采用RSA+AES混合加密方案。" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function request(overrides: Partial<RichTextPolishRequest> = {}): RichTextPolishRequest {
  return {
    resumeId: "resume_abc",
    section: "projects",
    fieldPath: "projects.0.content",
    locale: "zh-CN",
    content: {
      format: "tiptap_json",
      plainText: "项目描述：负责企业内部部门管理系统的前后端开发。",
      tiptapJson: TIPTAP_FIXTURE,
    },
    intent: { mode: "polish", tone: "professional", length: "same", strategy: "star" },
    ...overrides,
  };
}

describe("TipTap 文本块提取", () => {
  it("按文档顺序提取非空 paragraph", () => {
    const blocks = extractTipTapTextBlocks(TIPTAP_FIXTURE);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toContain("项目描述：");
    expect(blocks[1].text).toBe("项目难点：");
    expect(blocks[2].text).toContain("RSA");
  });

  it("跳过空 paragraph（与重建时的收集口径一致）", () => {
    const withEmpty = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "有内容" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [] },
      ],
    };
    expect(extractTipTapTextBlocks(withEmpty)).toHaveLength(1);
  });

  it("非对象输入返回空数组（不抛异常）", () => {
    expect(extractTipTapTextBlocks(null)).toEqual([]);
    expect(extractTipTapTextBlocks("x")).toEqual([]);
    expect(extractTipTapTextBlocks(undefined)).toEqual([]);
  });

  it("长文本在**结构摘要**里截断到 120 字符（不改实际写入内容）", () => {
    const long = "字".repeat(200);
    const blocks = extractTipTapTextBlocks({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: long }] }],
    });
    expect(blocks[0].text.length).toBeLessThanOrEqual(120);
    expect(blocks[0].text.endsWith("...")).toBe(true);
  });
});

describe("TipTap 重建（迁移正确性的核心）", () => {
  it("保留粗体标签节点与其 marks，只替换其后正文", () => {
    const provider = JSON.stringify({
      polishedText:
        "项目描述：负责企业内部部门管理系统前后端开发与安全体系建设。\n项目难点：\n登录请求采用RSA+AES混合加密方案，降低中间人攻击风险。",
      polishedBlocks: [
        "项目描述：负责企业内部部门管理系统前后端开发与安全体系建设。",
        "项目难点：",
        "登录请求采用RSA+AES混合加密方案，降低中间人攻击风险。",
      ],
      changeSummary: "保留富文本结构，优化项目描述和难点表达。",
      riskFlags: [],
    });

    const parsed = parsePolishProviderResponse(provider, request());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("预期解析成功");
    expect(parsed.result.format).toBe("tiptap_json");
    if (parsed.result.format !== "tiptap_json") throw new Error("预期 tiptap");

    const replacement = parsed.result.replacementTiptapJson as typeof TIPTAP_FIXTURE;
    // 外层结构不变。
    expect(replacement.content[0].type).toBe("bulletList");
    expect(replacement.content[0].content[0].content[0]).toMatchObject({
      type: "paragraph",
      attrs: { textAlign: "left" },
    });
    // 关键：粗体标签节点被原样保留。
    expect(replacement.content[0].content[0].content[0].content[0]).toMatchObject({
      type: "text",
      marks: [{ type: "bold" }],
      text: "项目描述：",
    });
    // 正文被替换，且格式属性没丢。
    const serialized = JSON.stringify(replacement);
    expect(serialized).toContain("负责企业内部部门管理系统前后端开发与安全体系建设");
    expect(serialized).toContain("降低中间人攻击风险");
    expect(serialized).toContain('"textAlign":"left"');
  });

  it("块数不符时**整体拒绝**，不按下标硬套（否则会把内容写错位置）", () => {
    const tooFew = JSON.stringify({
      polishedText: "x",
      polishedBlocks: ["只有一块"],
      changeSummary: "s",
      riskFlags: [],
    });
    const parsed = parsePolishProviderResponse(tooFew, request());
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("polishedBlocks");
  });

  it("块里有空字符串时拒绝（空块是模型漏答的信号，不是「保持原样」）", () => {
    const withEmpty = JSON.stringify({
      polishedText: "x",
      polishedBlocks: ["a", "  ", "c"],
      changeSummary: "s",
      riskFlags: [],
    });
    expect(parsePolishProviderResponse(withEmpty, request()).ok).toBe(false);
  });

  it("原始 doc 不被就地修改（返回的是克隆）", () => {
    const originalSnapshot = JSON.stringify(TIPTAP_FIXTURE);
    const provider = JSON.stringify({
      polishedText: "x",
      polishedBlocks: ["一", "二", "三"],
      changeSummary: "s",
      riskFlags: [],
    });
    parsePolishProviderResponse(provider, request());
    expect(JSON.stringify(TIPTAP_FIXTURE)).toBe(originalSnapshot);
  });

  it("plain_text 模式忽略 polishedBlocks，返回纯文本结果", () => {
    const provider = JSON.stringify({
      polishedText: "润色后的文本",
      changeSummary: "更顺",
      riskFlags: [],
    });
    const parsed = parsePolishProviderResponse(
      provider,
      request({ content: { format: "plain_text", plainText: "原文" } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("预期成功");
    expect(parsed.result.format).toBe("plain_text");
  });
});

describe("provider 响应解析", () => {
  it("缺 polishedText / changeSummary / riskFlags 都拒绝，并指明缺哪一项", () => {
    const base = { polishedText: "a", changeSummary: "b", riskFlags: [] };
    const cases: Array<[string, unknown, string]> = [
      ["polishedText", { ...base, polishedText: undefined }, "polishedText"],
      ["空 polishedText", { ...base, polishedText: "  " }, "polishedText"],
      ["changeSummary", { ...base, changeSummary: undefined }, "changeSummary"],
      ["riskFlags", { ...base, riskFlags: undefined }, "riskFlags"],
    ];
    for (const [, payload, expected] of cases) {
      const parsed = parsePolishProviderResponse(JSON.stringify(payload));
      expect(parsed.ok, expected).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain(expected);
    }
  });

  it("非法 JSON 与「不是对象」都被拒绝，错误消息区分两者", () => {
    const notJson = parsePolishProviderResponse("这不是 JSON");
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.message).toContain("invalid JSON");

    const notObject = parsePolishProviderResponse('"字符串"');
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.message).toContain("JSON object");
  });

  it("riskFlags 的类型必须在封闭集合内（未知类型不接受）", () => {
    const bad = JSON.stringify({
      polishedText: "a",
      changeSummary: "b",
      riskFlags: [{ type: "made_up_risk", message: "x" }],
    });
    expect(parsePolishProviderResponse(bad).ok).toBe(false);
  });

  it("接受四种已知风险类型", () => {
    for (const type of [
      "possible_fabrication",
      "changed_entity",
      "too_little_context",
      "unsafe_claim",
    ]) {
      const payload = JSON.stringify({
        polishedText: "a",
        changeSummary: "b",
        riskFlags: [{ type, message: "m" }],
      });
      const parsed = parsePolishProviderResponse(payload);
      expect(parsed.ok, type).toBe(true);
    }
  });

  it("返回稳定形状：polishedText / changeSummary / riskFlags", () => {
    const parsed = parsePolishProviderResponse(
      JSON.stringify({
        polishedText: "  前后有空格  ",
        changeSummary: "  摘要  ",
        riskFlags: [{ type: "unsafe_claim", message: "  消息  " }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("预期成功");
    expect(parsed.result.polishedText).toBe("前后有空格");
    expect(parsed.result.changeSummary).toBe("摘要");
    expect(parsed.result.riskFlags[0].message).toBe("消息");
  });
});

describe("请求校验", () => {
  it("experience / projects 默认 STAR，其余默认 plain", () => {
    const forSection = (section: string) =>
      validateRichTextPolishRequest({
        resumeId: "r",
        section,
        fieldPath: "f",
        locale: "zh-CN",
        content: { format: "plain_text", plainText: "x" },
      });
    for (const section of ["experience", "projects"]) {
      const result = forSection(section);
      expect(result.ok, section).toBe(true);
      if (result.ok) expect(result.request.intent.strategy, section).toBe("star");
    }
    for (const section of ["summary", "skills", "education"]) {
      const result = forSection(section);
      expect(result.ok, section).toBe(true);
      if (result.ok) expect(result.request.intent.strategy, section).toBe("plain");
    }
  });

  it("缺字段与非法枚举返回 400 并指明字段", () => {
    const cases: Array<[unknown, string]> = [
      [{}, "resumeId"],
      [{ resumeId: "r" }, "section"],
      [{ resumeId: "r", section: "nope" }, "section"],
      [{ resumeId: "r", section: "summary" }, "fieldPath"],
      [{ resumeId: "r", section: "summary", fieldPath: "f", locale: "en" }, "locale"],
    ];
    for (const [body, expected] of cases) {
      const result = validateRichTextPolishRequest(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.statusCode).toBe(400);
        expect(result.message).toContain(expected);
      }
    }
  });

  it("超过 4000 字符返回 **413**（形状对但太大，与 400 区分）", () => {
    const result = validateRichTextPolishRequest({
      resumeId: "r",
      section: "summary",
      fieldPath: "f",
      locale: "zh-CN",
      content: { format: "plain_text", plainText: "字".repeat(4001) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.statusCode).toBe(413);
  });

  it("恰好 4000 字符通过（边界不含糊）", () => {
    const result = validateRichTextPolishRequest({
      resumeId: "r",
      section: "summary",
      fieldPath: "f",
      locale: "zh-CN",
      content: { format: "plain_text", plainText: "字".repeat(4000) },
    });
    expect(result.ok).toBe(true);
  });

  it("intent.mode 必须是 polish（这是润色入口，不是通用改写）", () => {
    const result = validateRichTextPolishRequest({
      resumeId: "r",
      section: "summary",
      fieldPath: "f",
      locale: "zh-CN",
      content: { format: "plain_text", plainText: "x" },
      intent: { mode: "rewrite" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("intent.mode");
  });
});

describe("提示词构造", () => {
  it("注入新 core，同时保留旧微服务的 6 条严格规则", () => {
    const prompt = buildPolishPrompt(request(), CORE_V1, 3);
    // 新 core 在（这是本次改版的目的）。
    expect(prompt.system).toContain("你是中文简历编辑助手");
    // 旧 6 条规则也在（润色场景特有的硬边界，不与 core 重复）。
    expect(prompt.system).toContain("不得把“参与”改成“主导”");
    expect(prompt.system).toContain("输出必须是合法 JSON");
  });

  it("把 textBlockCount 告诉模型（TipTap 模式下它必须按块返回）", () => {
    const prompt = buildPolishPrompt(request(), CORE_V1, 3);
    expect(prompt.developer).toContain("textBlockCount=3");
  });

  it("plain_text 模式不注入 TipTap 结构规则（无关约束会分散注意力）", () => {
    const prompt = buildPolishPrompt(
      request({ content: { format: "plain_text", plainText: "x" } }),
      CORE_V1,
      0,
    );
    expect(prompt.developer).not.toContain("polishedBlocks 必须与 textBlockCount");
  });

  it("strategy=plain 时不注入 STAR 说明", () => {
    const plain = buildPolishPrompt(
      request({ intent: { mode: "polish", tone: "professional", length: "same", strategy: "plain" } }),
      CORE_V1,
      1,
    );
    expect(plain.developer).not.toContain("STAR 原则");
  });

  it("tone 与 length 各自渲染为对应说明", () => {
    const prompt = buildPolishPrompt(
      request({ intent: { mode: "polish", tone: "concise", length: "shorter", strategy: "plain" } }),
      CORE_V1,
      1,
    );
    expect(prompt.developer).toContain("tone=concise");
    expect(prompt.developer).toContain("length=shorter");
  });

  it("user 段是原文（模型看到的输入就是这段文本）", () => {
    const prompt = buildPolishPrompt(request(), CORE_V1, 3);
    expect(prompt.user).toBe("项目描述：负责企业内部部门管理系统的前后端开发。");
  });

  it("developer 段保留 JSON schema（改字段名会让解析整体失败）", () => {
    const prompt = buildPolishPrompt(request(), CORE_V1, 3);
    expect(prompt.developer).toContain("polishedText");
    expect(prompt.developer).toContain("polishedBlocks");
    expect(prompt.developer).toContain("changeSummary");
    expect(prompt.developer).toContain("riskFlags");
  });
});
