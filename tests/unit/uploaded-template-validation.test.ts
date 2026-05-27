import { describe, it, expect, vi, afterEach } from "vitest";
import {
  UploadedTemplate,
  DecorationConfig,
  FrameConfig,
  LayoutConfig,
} from "@/lib/templates/uploaded/types";
import { parseTemplateRow } from "@/lib/templates/uploaded/fetch";
import type { templates as templatesTable } from "@/db/schema";

// ============================================================================
// 合法 fixture builder —— 各测试基于此 mutate 出"少一字段 / 字段错值"等
// 错误形状，避免每个 case 都从零写一份完整对象。
// ============================================================================

function legalLayout(): unknown {
  return {
    frame: { kind: "vertical" },
    headerVariant: "professional",
    sectionTitleVariant: "professional",
    itemHeaderVariant: "professional",
    theme: { primaryColor: "#000" },
    sectionIcons: {},
  };
}

function legalRow(): typeof templatesTable.$inferSelect {
  return {
    id: "abbey",
    name: "Abbey",
    description: null,
    thumbnailUrl: null,
    source: "uploaded",
    decoration: null,
    layout: legalLayout(),
    customHtml: null,
    customCss: null,
    status: "published",
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as typeof templatesTable.$inferSelect;
}

// ============================================================================
// schema-level 校验
// ============================================================================

describe("UploadedTemplate Zod schema", () => {
  it("接受最小合法 fixture", () => {
    const row = legalRow();
    const result = UploadedTemplate.safeParse({
      id: row.id,
      name: row.name,
      description: row.description,
      thumbnailUrl: row.thumbnailUrl,
      decoration: row.decoration,
      layout: row.layout,
      customHtml: row.customHtml,
      customCss: row.customCss,
    });
    expect(result.success).toBe(true);
  });

  it("decoration 可以是 null（与 jsonb 列定义一致）", () => {
    const result = DecorationConfig.nullable().safeParse(null);
    expect(result.success).toBe(true);
  });

  it("decoration 缺 placement 字段失败", () => {
    const result = DecorationConfig.safeParse({
      bgImageUrl: "https://x/y.png",
      // placement 缺失
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// FrameConfig discriminated union —— narrowing + 错误形状拦截
// ============================================================================

describe("FrameConfig discriminated union", () => {
  it("vertical 不需要其他字段", () => {
    expect(FrameConfig.safeParse({ kind: "vertical" }).success).toBe(true);
  });

  it("horizontal 必须带 sidebar", () => {
    expect(FrameConfig.safeParse({ kind: "horizontal" }).success).toBe(false);
  });

  it("horizontal sidebar 必须带 side / width / sections", () => {
    expect(
      FrameConfig.safeParse({
        kind: "horizontal",
        sidebar: { side: "left" }, // width / sections 缺
      }).success,
    ).toBe(false);
  });

  it("kind 是非法字面量值时失败（不是 vertical / horizontal）", () => {
    expect(FrameConfig.safeParse({ kind: "diagonal" }).success).toBe(false);
  });

  it("sidebar.side 必须是 left 或 right", () => {
    expect(
      FrameConfig.safeParse({
        kind: "horizontal",
        sidebar: { side: "center", width: "240px", sections: [] },
      }).success,
    ).toBe(false);
  });

  it("narrowing 工作 —— horizontal 分支的 sidebar 类型可被访问", () => {
    const data: unknown = {
      kind: "horizontal",
      sidebar: {
        side: "left",
        width: "240px",
        sections: ["skills"],
      },
    };
    const parsed = FrameConfig.parse(data);
    if (parsed.kind === "horizontal") {
      // TypeScript narrowing 必须让 sidebar 字段可访问
      expect(parsed.sidebar.side).toBe("left");
      expect(parsed.sidebar.sections).toEqual(["skills"]);
    } else {
      throw new Error("narrowing 失败");
    }
  });
});

// ============================================================================
// LayoutConfig variant 字段 —— 用 z.enum 拦截非法字符串值
// ============================================================================

describe("LayoutConfig variant enums", () => {
  it("headerVariant 非法字符串失败", () => {
    const result = LayoutConfig.safeParse({
      ...(legalLayout() as Record<string, unknown>),
      headerVariant: "wat",
    });
    expect(result.success).toBe(false);
  });

  it("sectionTitleVariant 非法字符串失败", () => {
    const result = LayoutConfig.safeParse({
      ...(legalLayout() as Record<string, unknown>),
      sectionTitleVariant: "futuristic",
    });
    expect(result.success).toBe(false);
  });

  it("sectionTitleVariant 接受 'card-wrapped'（spec §6.3 新加）", () => {
    const result = LayoutConfig.safeParse({
      ...(legalLayout() as Record<string, unknown>),
      sectionTitleVariant: "card-wrapped",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// parseTemplateRow —— 信任边界优雅降级（坏行 skip 不抛错）
// ============================================================================

describe("parseTemplateRow", () => {
  // 静音 console.warn —— 测试预期会触发 warn
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => {
    warnSpy.mockClear();
  });

  it("合法 row 返回 UploadedTemplate", () => {
    const result = parseTemplateRow(legalRow());
    expect(result).not.toBeNull();
    expect(result?.id).toBe("abbey");
    expect(result?.layout.frame.kind).toBe("vertical");
  });

  it("layout 缺 frame 字段时返回 null（不抛错）", () => {
    const row = legalRow();
    const layout = row.layout as Record<string, unknown>;
    delete layout.frame;
    expect(parseTemplateRow(row)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("layout.frame.kind 非法时返回 null", () => {
    const row = legalRow();
    (row.layout as { frame: { kind: string } }).frame.kind = "diagonal";
    expect(parseTemplateRow(row)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("decoration 形状不对（jsonb 被人手改）返回 null", () => {
    const row = legalRow();
    row.decoration = { bgImageUrl: 123 } as unknown as typeof row.decoration; // bgImageUrl 应是 string
    expect(parseTemplateRow(row)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("warn message 携带 id 信息（方便定位坏行）", () => {
    const row = legalRow();
    row.id = "broken-001";
    (row.layout as { frame: unknown }).frame = null;
    parseTemplateRow(row);
    const calls = warnSpy.mock.calls;
    expect(
      calls.some((args) =>
        args.some(
          (a) => typeof a === "string" && a.includes("broken-001"),
        ),
      ),
    ).toBe(true);
  });

  it("horizontal frame 缺 sidebar 时返回 null（不击穿整页）", () => {
    const row = legalRow();
    (row.layout as { frame: unknown }).frame = { kind: "horizontal" };
    expect(parseTemplateRow(row)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
