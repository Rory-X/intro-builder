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
});
