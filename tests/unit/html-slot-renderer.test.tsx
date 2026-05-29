import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SlotRenderer } from "@/lib/templates/uploaded/html-slot-renderer";
import { emptyResumeContent, type ResumeContent, DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";
import { emptyDoc } from "@/lib/tiptap-types";

function richDoc(text: string): ReturnType<typeof emptyDoc> {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  };
}

function makeContent(over: Partial<ResumeContent> = {}): ResumeContent {
  const base = emptyResumeContent();
  return {
    ...base,
    basics: {
      ...base.basics,
      name: "张三",
      title: "前端工程师",
      email: "z@example.com",
      summary: "三年前端经验",
      ...over.basics,
    },
    experience: over.experience ?? [
      {
        company: "字节跳动",
        title: "前端工程师",
        start: "2022.07",
        end: "至今",
        location: "北京",
        content: richDoc("主导编辑器重构"),
      },
    ],
    education: over.education ?? [
      {
        school: "北京邮电大学",
        degree: "本科",
        major: "计算机科学",
        location: "北京",
        start: "2018.09",
        end: "2022.06",
        gpa: "3.7",
        highlights: emptyDoc(),
      },
    ],
    sectionOrder: over.sectionOrder ?? ["experience", "education"],
  };
}

const render_ = (props: Partial<Parameters<typeof SlotRenderer>[0]> = {}) =>
  render(
    <SlotRenderer
      html={props.html ?? "<article></article>"}
      css={props.css ?? null}
      content={props.content ?? makeContent()}
      styleSettings={props.styleSettings ?? DEFAULT_STYLE_SETTINGS}
      templateId={props.templateId ?? "test-tpl"}
    />,
  );

describe("SlotRenderer — value slots", () => {
  it("replaces basics.name slot with content.basics.name", () => {
    const { container } = render_({
      html: '<article><h1><slot data-bind="basics.name" /></h1></article>',
    });
    expect(container.querySelector("h1")?.textContent).toBe("张三");
  });

  it("replaces multiple basics slots in one template", () => {
    const { container } = render_({
      html: `<article>
        <h1><slot data-bind="basics.name" /></h1>
        <p><slot data-bind="basics.title" /> · <slot data-bind="basics.email" /></p>
      </article>`,
    });
    expect(container.querySelector("h1")?.textContent).toBe("张三");
    expect(container.querySelector("p")?.textContent).toContain("前端工程师");
    expect(container.querySelector("p")?.textContent).toContain("z@example.com");
  });

  it("renders [未知 slot] for invalid binding name", () => {
    const { container } = render_({
      html: '<article><slot data-bind="experience.foobar" /></article>',
    });
    expect(container.textContent).toContain("[未知 slot: experience.foobar]");
  });

  it("renders [ctx 不可用] for section.* slot used outside sectionOrder loop", () => {
    const { container } = render_({
      html: '<article><slot data-bind="section.title" /></article>',
    });
    expect(container.textContent).toContain("ctx 不可用");
  });

  it("renders [ctx 不可用] for item.* slot used outside section.items loop", () => {
    const { container } = render_({
      html: '<article><slot data-bind="item.title" /></article>',
    });
    expect(container.textContent).toContain("ctx 不可用");
  });
});

describe("SlotRenderer — sectionOrder loop", () => {
  it("iterates sectionOrder and substitutes section.title in each", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <h2 class="section-title"><slot data-bind="section.title" /></h2>
      </template>`,
    });
    const titles = Array.from(
      container.querySelectorAll("h2.section-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["工作经历", "教育背景"]);
  });

  it("provides section.id in iteration context", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <div data-id><slot data-bind="section.id" /></div>
      </template>`,
    });
    const ids = Array.from(container.querySelectorAll("[data-id]")).map(
      (el) => el.textContent,
    );
    expect(ids).toEqual(["experience", "education"]);
  });

  it("skips sections with no content", () => {
    const { container } = render_({
      content: makeContent({ experience: [], education: [] }),
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <h2><slot data-bind="section.title" /></h2>
      </template>`,
    });
    expect(container.querySelectorAll("h2")).toHaveLength(0);
  });
});

describe("SlotRenderer — section.items loop (nested)", () => {
  it("iterates items inside sectionOrder, substituting item.title for each", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <section>
          <h2><slot data-bind="section.title" /></h2>
          <slot data-bind="section.items" data-template="item" />
        </section>
      </template>
      <template id="item">
        <div class="item-title"><slot data-bind="item.title" /></div>
      </template>`,
    });
    const titles = Array.from(container.querySelectorAll(".item-title")).map(
      (el) => el.textContent,
    );
    // experience.company + education.school
    expect(titles).toEqual(["字节跳动", "北京邮电大学"]);
  });

  it("derives education.subtitle from degree + major + gpa", () => {
    const { container } = render_({
      content: makeContent({ sectionOrder: ["education"] }),
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <slot data-bind="section.items" data-template="item" />
      </template>
      <template id="item">
        <div class="item-subtitle"><slot data-bind="item.subtitle" /></div>
      </template>`,
    });
    const subtitle = container.querySelector(".item-subtitle")?.textContent;
    expect(subtitle).toContain("本科");
    expect(subtitle).toContain("计算机科学");
    expect(subtitle).toContain("GPA 3.7");
  });

  it("substitutes item.bullets with RichText render", () => {
    const { container } = render_({
      content: makeContent({ sectionOrder: ["experience"] }),
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <slot data-bind="section.items" data-template="item" />
      </template>
      <template id="item">
        <div class="bullets"><slot data-bind="item.bullets" /></div>
      </template>`,
    });
    expect(container.querySelector(".bullets")?.textContent).toContain(
      "主导编辑器重构",
    );
  });
});

describe("SlotRenderer — security", () => {
  it("strips <script> tags via DOMPurify", () => {
    const { container } = render_({
      html: '<article><script>window.x=1</script><h1><slot data-bind="basics.name" /></h1></article>',
    });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("张三");
  });

  it("strips on* event attributes", () => {
    const { container } = render_({
      html: '<article><h1 onclick="alert(1)"><slot data-bind="basics.name" /></h1></article>',
    });
    const h1 = container.querySelector("h1");
    expect(h1?.getAttribute("onclick")).toBeNull();
  });

  it("strips iframe", () => {
    const { container } = render_({
      html: '<article><iframe src="https://evil"></iframe><h1><slot data-bind="basics.name" /></h1></article>',
    });
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("SlotRenderer — CSS scope + style injection", () => {
  it("scopes CSS rules and injects styleSettings as CSS variables", () => {
    const { container } = render_({
      html: '<article><h1 class="my-name"><slot data-bind="basics.name" /></h1></article>',
      css: ".my-name { color: red }",
      styleSettings: { fontFamily: "serif", fontSize: 14, lineHeight: 1.7, pagePadding: 40, sectionGap: 16, itemGap: 12 },
    });
    const root = container.querySelector("[data-template-id='test-tpl']") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.getPropertyValue("--font-size")).toBe("14px");
    expect(root.style.getPropertyValue("--line-height")).toBe("1.7");
    expect(root.style.getPropertyValue("--page-padding")).toBe("40px");
    expect(root.style.getPropertyValue("--section-gap")).toBe("16px");
    expect(root.style.getPropertyValue("--item-gap")).toBe("12px");
    const styleEl = root.querySelector("style");
    expect(styleEl?.textContent).toContain('[data-template-id="test-tpl"] .my-name');
  });

  it("silently bails on forbidden CSS at-rules without crashing", () => {
    const { container } = render_({
      html: '<article><h1><slot data-bind="basics.name" /></h1></article>',
      css: "@media (min-width: 600px) { .x { color: red } }",
    });
    // Should still render the h1; no <style> tag emitted because scopeCss threw
    expect(container.querySelector("h1")?.textContent).toBe("张三");
    expect(container.querySelector("style")).toBeNull();
  });
});

describe("SlotRenderer — template extraction", () => {
  it("removes <template> blocks from the rendered tree", () => {
    const { container } = render_({
      html: `<article><h1><slot data-bind="basics.name" /></h1></article>
      <template id="unused"><div>SHOULD NOT APPEAR</div></template>`,
    });
    expect(container.textContent).not.toContain("SHOULD NOT APPEAR");
    expect(container.querySelector("template")).toBeNull();
  });
});
