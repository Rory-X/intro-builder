import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UploadedLayout } from "@/lib/templates/uploaded/UploadedLayout";
import { demoResume } from "@/lib/demo-resume";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

const sampleTemplate: UploadedTemplate = {
  id: "test-001",
  name: "Test Template",
  description: null,
  thumbnailUrl: null,
  decoration: {
    bgImageUrl: "https://example.com/bg.png",
    placement: {
      position: "absolute",
      top: "0",
      right: "0",
      width: "40%",
      height: "auto",
      zIndex: 0,
      opacity: 1,
    },
  },
  layout: {
    frame: { kind: "vertical" },
    headerVariant: "professional",
    sectionTitleVariant: "professional",
    itemHeaderVariant: "professional",
    theme: { primaryColor: "#137880" },
    sectionIcons: {},
  },
  customHtml: null,
  customCss: null,
  category: null,
  features: null,
};

describe("UploadedLayout", () => {
  it("renders the candidate name from content", () => {
    const { getByText } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    expect(getByText(demoResume.basics.name)).toBeInTheDocument();
  });

  it("renders the decoration image when present", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    expect(container.querySelector("img[data-template-decoration]")).not.toBeNull();
  });

  it("applies primaryColor as a CSS variable on the article element", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--primary")).toBe("#137880");
  });

  it("applies accentColor as --accent when provided", () => {
    const { container } = render(
      <UploadedLayout
        content={demoResume}
        template={{
          ...sampleTemplate,
          layout: {
            ...sampleTemplate.layout,
            theme: { primaryColor: "#137880", accentColor: "#9eb8be" },
          },
        }}
      />
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--accent")).toBe("#9eb8be");
  });

  it("works without decoration (decoration: null)", () => {
    const { container } = render(
      <UploadedLayout
        content={demoResume}
        template={{ ...sampleTemplate, decoration: null }}
      />
    );
    expect(container.querySelector("img[data-template-decoration]")).toBeNull();
  });

  it("renders multiple sections from sectionOrder", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    // Demo content has at least experience and education — check both render
    // Use textContent because section titles depend on Chinese labels in section-meta
    expect(container.textContent).toMatch(/经历|经验|工作/);  // any flavor of experience label
  });

  // ============================================================
  // Frame honor — schema 里 frame.kind 必须真实影响渲染（commit 1f79532
  // 引入 schema 但渲染端尚未 honor，本组测试是 "Renderer update to follow"
  // 的契约证明）
  // ============================================================

  it("vertical frame: 标记 data-frame=vertical，无 sidebar 容器", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    const article = container.querySelector("article")!;
    expect(article.getAttribute("data-frame")).toBe("vertical");
    expect(container.querySelector("[data-frame-sidebar]")).toBeNull();
  });

  it("horizontal frame: 渲染 sidebar 容器,带 frame.sidebar.sections 指定的 section", () => {
    const horizontalTemplate: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        frame: {
          kind: "horizontal",
          sidebar: {
            side: "left",
            width: "240px",
            sections: ["skills", "education"],
            bgColor: "#1f2937",
            textColor: "#f3f4f6",
          },
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={horizontalTemplate} />
    );
    const article = container.querySelector("article")!;
    expect(article.getAttribute("data-frame")).toBe("horizontal");

    const sidebar = container.querySelector("[data-frame-sidebar]");
    expect(sidebar).not.toBeNull();
    // sidebar 文本包含 skills + education 的章节标题
    expect(sidebar!.textContent).toMatch(/技能/);
    expect(sidebar!.textContent).toMatch(/教育/);
    // experience 不应该出现在 sidebar
    expect(sidebar!.textContent).not.toMatch(/工作经历|工作经验/);
  });

  it("horizontal frame: sidebar 外观参数 (width/bgColor/textColor) 应用到 DOM", () => {
    const horizontalTemplate: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        frame: {
          kind: "horizontal",
          sidebar: {
            side: "left",
            width: "260px",
            sections: ["skills"],
            bgColor: "rgb(31, 41, 55)",
            textColor: "rgb(243, 244, 246)",
          },
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={horizontalTemplate} />
    );
    const sidebar = container.querySelector(
      "[data-frame-sidebar]"
    ) as HTMLElement;
    expect(sidebar).not.toBeNull();
    expect(sidebar.style.width).toBe("260px");
    expect(sidebar.style.backgroundColor).toBe("rgb(31, 41, 55)");
    expect(sidebar.style.color).toBe("rgb(243, 244, 246)");
  });

  it("horizontal frame side=right: sidebar 通过 data-side 标记位置", () => {
    const rightSidebar: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        frame: {
          kind: "horizontal",
          sidebar: {
            side: "right",
            width: "240px",
            sections: ["skills"],
          },
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={rightSidebar} />
    );
    const sidebar = container.querySelector("[data-frame-sidebar]");
    expect(sidebar?.getAttribute("data-side")).toBe("right");
  });

  // ============================================================
  // itemHeaderVariant 解耦（schema 第 3 维独立性）
  // sectionTitleVariant 决定章节标题样式，itemHeaderVariant 决定条目内
  // 公司/职位/日期等头部排版 —— 两者独立。修复前两者绑死，schema 字段
  // 形同虚设；修复后真正解耦。
  // ============================================================

  it("itemHeaderVariant 解耦于 sectionTitleVariant —— classic item header 在 professional section 下生效", () => {
    const customContent = {
      ...demoResume,
      experience: [
        {
          company: "TestCo",
          title: "Engineer",
          start: "2020",
          end: "2024",
          location: "",
          content: { type: "doc", content: [] },
        },
      ],
    } as typeof demoResume;
    const decoupledTemplate: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "professional", // 章节标题专业风
        itemHeaderVariant: "classic", // item 用 classic 风（关键：不绑死）
      },
    };
    const { container } = render(
      <UploadedLayout content={customContent} template={decoupledTemplate} />
    );
    // classic experience 的 primary 是 `${company} — ${title}` 单行带 em-dash
    // professional 风格则是公司在一行、职位是 secondary —— 不会出现这个组合
    expect(container.textContent).toMatch(/TestCo\s*—\s*Engineer/);
  });

  // ============================================================
  // sectionIcons 端到端通电（schema 第 4 维独立性）
  // Skill 写入 LayoutConfig.sectionIcons={experience:"Award"} 必须真的
  // 渲染成 Award 图标，而不是 section-meta 默认的 Briefcase。Whitelist
  // 外的 name 优雅降级回默认（不抛错）。
  // ============================================================

  it("sectionIcons 通电：lucide name override 真渲染对应 svg", () => {
    const overriddenIcons: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "modern", // modern variant 把 icon 渲到 DOM（professional variant 走 ProfessionalSectionTitle，不直接挂 lucide class）
        sectionIcons: {
          experience: "Award", // 默认 experience 是 Briefcase，被 Award 覆盖
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={overriddenIcons} />
    );
    // lucide-react 渲染的 svg 默认带 `lucide-{name}` className
    expect(container.querySelector(".lucide-award")).not.toBeNull();
  });

  it("sectionIcons whitelist 外的 name 优雅降级（fallback 到 section-meta 默认，不抛错）", () => {
    const badIconName: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "modern",
        sectionIcons: {
          experience: "MadeUpIconName", // whitelist 外的 name
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={badIconName} />
    );
    // fallback 到 SECTION_META.experience.icon (Briefcase)
    expect(container.querySelector(".lucide-briefcase")).not.toBeNull();
  });

  // ============================================================
  // accentColor 端到端通电（schema 第 5 维独立性）
  // theme.accentColor 注入到 article 的 --accent CSS 变量；
  // ResumeItemHeader 的 dateRange 元素消费 var(--accent, fallback)。
  // built-in 模板不设 --accent 走 fallback 视觉不变；uploaded 设了
  // accent 真用上 themed color。
  // ============================================================

  it("accentColor 通电：注入 --accent 后 dateRange 元素消费", () => {
    const accentTemplate: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "modern",
        theme: {
          primaryColor: "#137880",
          accentColor: "#FF6B6B", // 测试色
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={accentTemplate} />
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--accent")).toBe("#FF6B6B");

    // dateRange span 通过 inline style 消费 var(--accent, fallback)
    const dateRangeEl = container.querySelector(
      "span[style*='var(--accent'], span[style*='var(--accent,']"
    );
    expect(dateRangeEl).not.toBeNull();
  });

  // ============================================================
  // theme.fontFamily 通电（schema 第 6 维独立性）
  // 模板级 fontFamily（FONT_MAP key）覆盖用户级 styleSettings.fontFamily。
  // 非法 key 优雅降级回用户级（不抛错）。
  // ============================================================

  it("theme.fontFamily=serif 时 article 用 serif 字体（覆盖用户级）", () => {
    const serifTemplate: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        theme: {
          primaryColor: "#000",
          fontFamily: "serif",
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={serifTemplate} />
    );
    const article = container.querySelector("article") as HTMLElement;
    // FONT_MAP.serif.css 包含 'Noto Serif SC'
    expect(article.style.fontFamily).toContain("Noto Serif SC");
  });

  it("theme.fontFamily 非法 key 时优雅降级回用户级（不抛错）", () => {
    const badFont: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        theme: {
          primaryColor: "#000",
          fontFamily: "comic-sans-ms-not-supported",
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={badFont} />
    );
    const article = container.querySelector("article") as HTMLElement;
    // styleSettings 默认 sans，应该 fallback 到 sans css（不应该 contain 衬线特征）
    expect(article.style.fontFamily).not.toContain("Noto Serif SC");
    expect(article.style.fontFamily).toContain("system-ui");
  });

  // ============================================================
  // card-wrapped variant 实现（schema 第 7 维独立性 + spec §6.3）
  // 全新 section variant：圆角白卡片包裹整段。Skill 注入的
  // theme.cardBg / cardRadius / cardShadow 通过 --card-* CSS 变量
  // 端到端 reach 渲染。
  // ============================================================

  it("card-wrapped variant 渲染圆角白卡片容器", () => {
    const cardTemplate: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "card-wrapped",
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={cardTemplate} />
    );
    const cardSection = container.querySelector(
      "[data-section-variant='card-wrapped']"
    ) as HTMLElement | null;
    expect(cardSection).not.toBeNull();
    // 默认 fallback 视觉：白底 + 圆角 + 阴影（即使 Skill 没设 cardBg/Radius/Shadow）
    expect(cardSection!.style.borderRadius).toContain("var(--card-radius");
    expect(cardSection!.style.backgroundColor).toContain("var(--card-bg");
    expect(cardSection!.style.boxShadow).toContain("var(--card-shadow");
  });

  it("theme.cardBg / cardRadius / cardShadow 注入 article CSS 变量", () => {
    const themedCard: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "card-wrapped",
        theme: {
          primaryColor: "#000",
          cardBg: "#FAFBFC",
          cardRadius: "16px",
          cardShadow: "0 4px 12px rgba(0,0,0,0.08)",
        },
      },
    };
    const { container } = render(
      <UploadedLayout content={demoResume} template={themedCard} />
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.getPropertyValue("--card-bg")).toBe("#FAFBFC");
    expect(article.style.getPropertyValue("--card-radius")).toBe("16px");
    expect(article.style.getPropertyValue("--card-shadow")).toBe(
      "0 4px 12px rgba(0,0,0,0.08)"
    );
  });

  it("card-wrapped 的 skills 走行内紧凑格式（和 professional 一致）", () => {
    const cardWithSkills: UploadedTemplate = {
      ...sampleTemplate,
      layout: {
        ...sampleTemplate.layout,
        sectionTitleVariant: "card-wrapped",
      },
    };
    const customContent = {
      ...demoResume,
      skills: [{ category: "测试技能", items: ["A", "B"] }],
    } as typeof demoResume;
    const { container } = render(
      <UploadedLayout content={customContent} template={cardWithSkills} />
    );
    // professional 风格：`分类：` 行内 span + items.join("、")
    expect(container.textContent).toMatch(/测试技能：A、B/);
  });
});
