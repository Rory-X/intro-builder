import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { DEFAULT_STYLE_SETTINGS, emptyResumeContent } from "@intro-builder/shared/schemas";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

// db mock 同时满足 select(读旧 content) 和 update(写新值)。每个测试用例
// 用 mockReturnValue 链装好需要的形状。
vi.mock("@/db", () => ({
  db: {
    update: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock("@/lib/templates/registry-server", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/templates/registry-server")
  >("@/lib/templates/registry-server");
  return {
    ...actual,
    getTemplateMetaAsync: vi.fn(),
  };
});

import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  getTemplateMetaAsync,
} from "@/lib/templates/registry-server";
import { setTemplate } from "@/app/(app)/resume/[id]/edit/actions";

const professionalMeta = {
  id: "professional",
  name: "专业",
  description: "单栏清晰，适合中文互联网求职",
  category: "tech",
  features: [
    "单栏布局清晰，重点突出工作经历与项目",
    "适合中文互联网求职",
    "ATS 友好排版兼容投递系统",
  ],
  defaultStyleSettings: DEFAULT_STYLE_SETTINGS,
} as const;

const modernMeta = {
  id: "modern",
  name: "现代",
  description: "技术风双栏",
  category: "tech",
  features: [
    "双栏布局，深色 sidebar 突出技能与联系方式",
    "适合技术岗、设计岗，信息密度大",
    "紧凑排版适合内容丰富的简历",
  ],
  defaultStyleSettings: {
    fontFamily: "sans",
    fontSize: 12,
    bodyLineHeight: 1.5,
    lineHeight: 1.5,
    headingGap: 6,
    pagePadding: 32,
    sectionGap: 14,
    itemGap: 10,
    photoScale: 1,
  },
} as const;

function resolvedDbTemplate(meta: {
  id: string;
  name: string;
  description: string;
  category: string;
  features: readonly string[];
  defaultStyleSettings: object;
}) {
  return {
    source: "uploaded",
    id: meta.id,
    template: {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      thumbnailUrl: null,
      sectionIcons: {},
      html: "<main></main>",
      css: ".resume{}",
      category: meta.category,
      features: meta.features,
      defaultStyleSettings: meta.defaultStyleSettings,
    },
  };
}

function setupDbForResetPath(currentContent: object) {
  const limit = vi.fn().mockResolvedValue([{ content: currentContent }]);
  const where1 = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where: where1 });
  (db.select as unknown as Mock).mockReturnValue({ from });
  const where2 = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: where2 });
  (db.update as unknown as Mock).mockReturnValue({ set });
  return { set, where1, where2 };
}

function setupDbForNoResetPath() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  (db.update as unknown as Mock).mockReturnValue({ set });
  return { set };
}

describe("setTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
  });

  it("默认 resetStyleSettings=true：写 templateId + 用模板默认 styleSettings 覆盖", async () => {
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue(
      resolvedDbTemplate(modernMeta),
    );
    const { set } = setupDbForResetPath({
      ...emptyResumeContent(),
      styleSettings: { fontFamily: "sans", fontSize: 18, lineHeight: 1.9, pagePadding: 50 },
    });

    await setTemplate("r1", "modern");

    expect(set).toHaveBeenCalledTimes(1);
    const call = set.mock.calls[0][0];
    expect(call.templateId).toBe("modern");
    expect(call.content?.styleSettings).toEqual(modernMeta.defaultStyleSettings);
    // content 其他字段不应该被改动 —— 只换 styleSettings
    expect(call.content?.basics).toBeDefined();
    expect(call.content?.experience).toBeDefined();
  });

  it("resetStyleSettings=false 时只写 templateId，不动 content", async () => {
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue(
      resolvedDbTemplate(modernMeta),
    );
    const { set } = setupDbForNoResetPath();

    await setTemplate("r1", "modern", { resetStyleSettings: false });

    expect(set).toHaveBeenCalledTimes(1);
    const call = set.mock.calls[0][0];
    expect(call.templateId).toBe("modern");
    expect(call.content).toBeUndefined();
    // db.select 不应被调用 —— 不需要读旧 content
    expect((db.select as unknown as Mock)).not.toHaveBeenCalled();
  });

  it("未知 templateId 走 getTemplateMetaAsync fallback（被收敛为 DB default）", async () => {
    // getTemplateMetaAsync 的合约：未知 id 回退到 DB default
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue(
      resolvedDbTemplate(professionalMeta),
    );
    const { set } = setupDbForNoResetPath();

    await setTemplate("r1", "definitely-nonexistent", {
      resetStyleSettings: false,
    });

    // 被改写成 fallback id —— 防止给 resume 写入坏 templateId
    expect(set.mock.calls[0][0].templateId).toBe("professional");
  });

  it("rejects 未鉴权请求", async () => {
    (auth as unknown as Mock).mockResolvedValue(null);
    await expect(setTemplate("r1", "modern")).rejects.toThrow(/unauthorized/);
  });

  it("默认值符合 plan：options 缺省时与 {resetStyleSettings:true} 行为一致", async () => {
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue(
      resolvedDbTemplate(professionalMeta),
    );
    const { set } = setupDbForResetPath({
      ...emptyResumeContent(),
      styleSettings: { ...DEFAULT_STYLE_SETTINGS },
    });

    await setTemplate("r1", "professional");

    const call = set.mock.calls[0][0];
    expect(call.content?.styleSettings).toEqual(
      professionalMeta.defaultStyleSettings,
    );
  });

  it("uploaded 模板：用标准 fallback styleSettings", async () => {
    (getTemplateMetaAsync as unknown as Mock).mockResolvedValue({
      source: "uploaded",
      id: "abbey-stub",
      template: {
        id: "abbey-stub",
        name: "Abbey Stub",
        description: "",
        thumbnailUrl: null,
        sectionIcons: {},
        html: "<main></main>",
        css: ".resume{}",
        category: null,
        features: null,
      },
    });
    const { set } = setupDbForResetPath({
      ...emptyResumeContent(),
      styleSettings: { fontFamily: "serif", fontSize: 18, lineHeight: 1.9, pagePadding: 50 },
    });

    await setTemplate("r1", "abbey-stub");

    const call = set.mock.calls[0][0];
    expect(call.templateId).toBe("abbey-stub");
    // uploaded fallback = STANDARD（来自 DENSITY_PRESETS.standard.settings）
    expect(call.content?.styleSettings).toEqual(DEFAULT_STYLE_SETTINGS);
  });
});
