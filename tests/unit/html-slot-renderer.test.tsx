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

type ContentOverride = Partial<Omit<ResumeContent, "basics">> & {
  basics?: Partial<ResumeContent["basics"]>;
};
function makeContent(over: ContentOverride = {}): ResumeContent {
  const base = emptyResumeContent();
  const { basics: overBasics, experience: overExp, education: overEdu, sectionOrder: overOrder, ...rest } = over;
  return {
    ...base,
    ...rest,
    basics: {
      ...base.basics,
      name: "张三",
      title: "前端工程师",
      email: "z@example.com",
      summary: "三年前端经验",
      ...overBasics,
    },
    experience: overExp ?? [
      {
        company: "字节跳动",
        title: "前端工程师",
        start: "2022.07",
        end: "至今",
        location: "北京",
        content: richDoc("主导编辑器重构"),
      },
    ],
    education: overEdu ?? [
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
    sectionOrder: overOrder ?? ["experience", "education"],
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
      sectionIcons={props.sectionIcons}
    />,
  );

const SECTION_FIXTURE_HTML = `
  <article class="fixture-resume">
    <header>
      <h1><slot data-bind="basics.name" /></h1>
      <div class="fixture-contact">
        <slot data-bind="basics.email" />
        <slot data-bind="basics.phone" />
      </div>
    </header>
    <slot data-bind="sectionOrder" data-template="section" />
  </article>
  <template id="section-block">
    <section class="fixture-section">
      <h2><slot data-bind="section.title" /></h2>
      <div class="fixture-body"><slot data-bind="section.body" /></div>
    </section>
  </template>
  <template id="section-list">
    <section class="fixture-section">
      <h2><slot data-bind="section.title" /></h2>
      <slot data-bind="section.items" data-template="item" />
    </section>
  </template>
  <template id="item">
    <div class="fixture-item">
      <strong class="fixture-item-title"><slot data-bind="item.title" /></strong>
      <span class="fixture-item-subtitle"><slot data-bind="item.subtitle" /></span>
      <span class="fixture-item-meta"><slot data-bind="item.meta" /></span>
      <span class="fixture-item-date"><slot data-bind="item.dateRange" /></span>
      <span class="fixture-item-location"><slot data-bind="item.location" /></span>
      <div class="fixture-item-bullets"><slot data-bind="item.bullets" /></div>
      <span class="fixture-item-link"><slot data-bind="item.link" /></span>
    </div>
  </template>
`;

function itemFieldsFixtureHtml(locationClass: string, metaClass: string): string {
  return `
    <article>
      <slot data-bind="sectionOrder" data-template="section" />
    </article>
    <template id="section-list">
      <section><slot data-bind="section.items" data-template="item" /></section>
    </template>
    <template id="section-block">
      <section><slot data-bind="section.body" /></section>
    </template>
    <template id="item">
      <div class="fixture-item">
        <span class="${locationClass}"><slot data-bind="item.location" /></span>
        <span class="${metaClass}">
          <slot data-bind="item.meta" />
          <slot data-bind="item.link" />
        </span>
      </div>
    </template>
  `;
}

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

describe("SlotRenderer — 联系字段自动 linkify（直绑路径）", () => {
  function renderBasics(field: string, basics: Partial<ResumeContent["basics"]>) {
    return render_({
      content: makeContent({ basics }),
      html: `<article><span class="c"><slot data-bind="${field}" /></span></article>`,
    });
  }

  it("email 直绑包成 mailto 链接，文本不变", () => {
    const { container } = renderBasics("basics.email", { email: "z@example.com" });
    const a = container.querySelector("span.c a");
    expect(a?.getAttribute("href")).toBe("mailto:z@example.com");
    expect(a?.textContent).toBe("z@example.com");
  });

  it("phone 直绑包成 tel 链接，并去掉空格", () => {
    const { container } = renderBasics("basics.phone", { phone: "138 0000 0000" });
    const a = container.querySelector("span.c a");
    expect(a?.getAttribute("href")).toBe("tel:13800000000");
    expect(a?.textContent).toBe("138 0000 0000");
  });

  it("website 缺协议头时补 https", () => {
    const { container } = renderBasics("basics.website", { website: "github.com/z" });
    const a = container.querySelector("span.c a");
    expect(a?.getAttribute("href")).toBe("https://github.com/z");
  });

  it("website 已带协议头则原样保留", () => {
    const { container } = renderBasics("basics.website", { website: "https://me.dev" });
    expect(container.querySelector("span.c a")?.getAttribute("href")).toBe("https://me.dev");
  });

  it("location 无可点目标，保持纯文本不包链接", () => {
    const { container } = renderBasics("basics.location", { location: "北京" });
    expect(container.querySelector("span.c a")).toBeNull();
    expect(container.querySelector("span.c")?.textContent).toBe("北京");
  });

  it("name 等非联系字段不 linkify", () => {
    const { container } = renderBasics("basics.name", { name: "张三" });
    expect(container.querySelector("span.c a")).toBeNull();
    expect(container.querySelector("span.c")?.textContent).toBe("张三");
  });

  it("profile.* 同名字段同样 linkify", () => {
    const { container } = renderBasics("profile.email", { email: "z@example.com" });
    expect(container.querySelector("span.c a")?.getAttribute("href")).toBe("mailto:z@example.com");
  });

  it("空值不渲染空链接", () => {
    const { container } = renderBasics("basics.website", { website: "" });
    expect(container.querySelector("span.c a")).toBeNull();
  });
});

describe("SlotRenderer — sectionOrder loop", () => {
  it("uses section kind templates for block and list sections", () => {
    const { container } = render_({
      content: makeContent({ sectionOrder: ["basics", "experience"] }),
      html: `<article>
        <slot data-bind="sectionOrder" data-template="section" />
      </article>
      <template id="section-block">
        <section class="block-section">
          <h2><slot data-bind="section.title" /></h2>
          <slot data-bind="section.body" />
        </section>
      </template>
      <template id="section-list">
        <section class="list-section">
          <h2><slot data-bind="section.title" /></h2>
          <slot data-bind="section.items" data-template="item" />
        </section>
      </template>
      <template id="item">
        <div class="item-title"><slot data-bind="item.title" /></div>
      </template>`,
    });
    expect(container.querySelector(".block-section")?.textContent).toContain("三年前端经验");
    expect(container.querySelector(".list-section .item-title")?.textContent).toBe("字节跳动");
  });

  it("renders section.icon as a lucide svg when declared via sectionIcons", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <h2><slot data-bind="section.icon" class="section-icon" /><slot data-bind="section.title" /></h2>
      </template>`,
      sectionIcons: { experience: { icon: "Briefcase" } },
    });
    const icon = container.querySelector("svg.section-icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("renders section.icon from SECTION_META fallback when no sectionIcons declared", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <h2><slot data-bind="section.icon" class="section-icon" /><slot data-bind="section.title" /></h2>
      </template>`,
    });
    const icon = container.querySelector("svg.section-icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("renders icon with declared color via inline style", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <h2><slot data-bind="section.icon" class="section-icon" /><slot data-bind="section.title" /></h2>
      </template>`,
      sectionIcons: { experience: { icon: "Briefcase", color: "#3b82f6" } },
    });
    const icon = container.querySelector("svg.section-icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveStyle({ color: "rgb(59, 130, 246)" });
  });

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

  it("auto-injects data-pagination-section on each section template's root tag", () => {
    // 防御 zoo 多次反馈的 v2 模板分页切到 section header 中间的 bug：
    // SlotRenderer 必须给 section template 的根标签加 data-pagination-section
    // 让 paginated-preview 的 findBreakPoints 能找到合法断点。
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <section class="my-section"><slot data-bind="section.title" /></section>
      </template>`,
    });
    const sections = Array.from(
      container.querySelectorAll("section.my-section"),
    );
    expect(sections.length).toBe(2);
    expect(sections[0].getAttribute("data-pagination-section")).toBe("experience");
    expect(sections[1].getAttribute("data-pagination-section")).toBe("education");
  });

  it("auto-injects data-pagination-item on each section.items template's root tag", () => {
    const { container } = render_({
      html: `<article>
        <slot data-bind="sectionOrder" data-template="sec" />
      </article>
      <template id="sec">
        <section><slot data-bind="section.items" data-template="entry" /></section>
      </template>
      <template id="entry">
        <div class="my-entry"><slot data-bind="item.title" /></div>
      </template>`,
    });
    const entries = Array.from(container.querySelectorAll("div.my-entry"));
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry) => {
      expect(entry.hasAttribute("data-pagination-item")).toBe(true);
    });
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

describe("SlotRenderer — profile contacts loop", () => {
  it("derives profile contacts and renders contact icons", () => {
    const { container } = render_({
      content: makeContent({
        basics: {
          email: "z@example.com",
          phone: "138",
          location: "北京",
          website: "github.com/z",
          title: "",
          status: "",
        },
      }),
      html: `<article>
        <h1><slot data-bind="profile.name" /></h1>
        <div class="contacts">
          <slot data-bind="profile.contacts" data-template="contact" />
        </div>
      </article>
      <template id="contact">
        <span class="contact"><slot data-bind="contact.icon" class="contact-icon" /><slot data-bind="contact.label" /></span>
      </template>`,
    });
    expect(container.querySelector("h1")?.textContent).toBe("张三");
    const contacts = Array.from(container.querySelectorAll(".contact")).map((el) => el.textContent);
    expect(contacts).toEqual(["138", "z@example.com", "北京", "github.com/z"]);
    expect(container.querySelectorAll("svg.contact-icon")).toHaveLength(4);
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
      styleSettings: {
        fontFamily: "serif", fontSize: 14,
        lineHeight: 1.7, bodyLineHeight: 1.7, headingGap: 12,
        pagePadding: 40, sectionGap: 16, itemGap: 12, photoScale: 1,
      },
    });
    const root = container.querySelector("[data-template-id='test-tpl']") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.getPropertyValue("--font-size")).toBe("14px");
    // --line-height kept as a back-compat alias of body line-height for v2
    // customCss authored before the split — same value as --body-line-height.
    expect(root.style.getPropertyValue("--line-height")).toBe("1.7");
    expect(root.style.getPropertyValue("--body-line-height")).toBe("1.7");
    expect(root.style.getPropertyValue("--heading-gap")).toBe("12px");
    expect(root.style.getPropertyValue("--page-padding")).toBe("40px");
    expect(root.style.getPropertyValue("--section-gap")).toBe("16px");
    expect(root.style.getPropertyValue("--item-gap")).toBe("12px");
    // Two <style> children: scoped customCss + renderer fixes (header font + marker color).
    const styleEls = root.querySelectorAll("style");
    expect(styleEls.length).toBe(2);
    expect(styleEls[0].textContent).toContain('[data-template-id="test-tpl"] .my-name');
  });

  it("silently bails on forbidden CSS at-rules without crashing", () => {
    const { container } = render_({
      html: '<article><h1><slot data-bind="basics.name" /></h1></article>',
      css: "@media (min-width: 600px) { .x { color: red } }",
    });
    // Should still render the h1; only the renderer fixes <style> emitted
    // (header font + marker color) since scopeCss threw.
    expect(container.querySelector("h1")?.textContent).toBe("张三");
    const styleEls = container.querySelectorAll("style");
    expect(styleEls.length).toBe(1); // only renderer fixes, no scoped CSS
  });
});

describe("SlotRenderer — image binding (<img data-bind>)", () => {
  const PHOTO = "https://x.public.blob.vercel-storage.com/photos/u/1-a.png";

  it("injects basics.photo URL into <img src> when photo is non-empty", () => {
    const { container } = render_({
      content: makeContent({ basics: { photo: PHOTO } }),
      html: `<article><img data-bind="basics.photo" class="avatar" alt="头像" /></article>`,
    });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(PHOTO);
  });

  it("keeps class/alt and does NOT leak data-bind to the DOM", () => {
    const { container } = render_({
      content: makeContent({ basics: { photo: PHOTO } }),
      html: `<article><img data-bind="basics.photo" class="avatar" alt="头像" /></article>`,
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("class")).toBe("avatar");
    expect(img?.getAttribute("alt")).toBe("头像");
    expect(img?.hasAttribute("data-bind")).toBe(false);
  });

  it("renders nothing (no <img>) when photo is empty — avoids broken-image", () => {
    const { container } = render_({
      content: makeContent({ basics: { photo: "" } }),
      html: `<article><img data-bind="basics.photo" class="avatar" alt="头像" /></article>`,
    });
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders placeholder when <img data-bind> targets a non-image binding", () => {
    const { container } = render_({
      html: `<article><img data-bind="basics.name" alt="x" /></article>`,
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("仅支持图片字段");
  });

  it("renders placeholder when basics.photo is used via <slot> instead of <img>", () => {
    const { container } = render_({
      content: makeContent({ basics: { photo: PHOTO } }),
      html: `<article><slot data-bind="basics.photo" /></article>`,
    });
    expect(container.textContent).not.toContain(PHOTO);
    expect(container.textContent).toContain("请用");
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

describe("SlotRenderer — section fixture integration", () => {
  const content = makeContent({
    basics: {
      name: "李四",
      title: "后端工程师",
      email: "li@example.com",
      phone: "13800138000",
      location: "上海",
      website: "https://li.dev",
      status: "求职中",
      summary: "五年后端经验",
      photo: "",
    },
    skills: richDoc("Python、Go、Rust"),
    custom: [{ id: "custom_hobby", title: "兴趣爱好", content: richDoc("热爱技术") }],
    sectionOrder: ["experience", "education", "skills", "custom_hobby"],
  });

  it("renders name and contact info", () => {
    const { container } = render_({
      html: SECTION_FIXTURE_HTML,
      css: ".fixture-resume { color: black; }",
      content,
      templateId: "fixture",
    });
    expect(container.textContent).toContain("李四");
    expect(container.textContent).toContain("li@example.com");
    expect(container.textContent).toContain("13800138000");
  });

  it("renders all sections without unknown-slot errors", () => {
    const { container } = render_({
      html: SECTION_FIXTURE_HTML,
      css: ".fixture-resume { color: black; }",
      content,
      templateId: "fixture",
    });
    const text = container.textContent ?? "";
    expect(text).not.toContain("[未知 slot]");
    expect(text).not.toContain("[ctx 不可用");
    expect(text).toContain("字节跳动");
    expect(text).toContain("北京邮电大学");
  });

  it("renders block sections (skills, custom) via section.body", () => {
    const { container } = render_({
      html: SECTION_FIXTURE_HTML,
      css: ".fixture-resume { color: black; }",
      content,
      templateId: "fixture",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Python、Go、Rust");
    expect(text).toContain("热爱技术");
  });

  it("renders promoted first-class block modules (summary/awards/portfolio) once each", () => {
    const promoted = makeContent({
      summary: richDoc("六年全栈经验"),
      awards: richDoc("国家奖学金"),
      portfolio: richDoc("开源项目 Foo"),
      sectionOrder: ["summary", "awards", "portfolio"],
    });
    const { container } = render_({
      html: SECTION_FIXTURE_HTML,
      css: ".fixture-resume { color: black; }",
      content: promoted,
      templateId: "fixture",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("六年全栈经验");
    expect(text).toContain("国家奖学金");
    expect(text).toContain("开源项目 Foo");
    // 标题来自 section-meta（固定），各渲染一次
    expect(container.querySelectorAll(".fixture-section").length).toBe(3);
  });

  it("renders list sections with item details", () => {
    const { container } = render_({
      html: SECTION_FIXTURE_HTML,
      css: ".fixture-resume { color: black; }",
      content,
      templateId: "fixture",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("主导编辑器重构");
    expect(text).toContain("2022.07");
  });
});

describe("SlotRenderer — item fields fixture", () => {
  const templates = [
    { id: "classic", locationSelector: ".classic-item-location", metaSelector: ".classic-item-meta" },
    { id: "professional", locationSelector: ".pro-item-location", metaSelector: ".pro-item-meta" },
    { id: "modern", locationSelector: ".modern-item-location", metaSelector: ".modern-item-meta" },
  ] as const;

  const content = makeContent({
    experience: [
      {
        company: "字节跳动",
        title: "前端工程师",
        start: "2022.07",
        end: "至今",
        location: "北京",
        content: richDoc("主导编辑器重构"),
      },
    ],
    education: [
      {
        school: "北京邮电大学",
        degree: "本科",
        major: "计算机科学",
        location: "广州",
        start: "2018.09",
        end: "2022.06",
        gpa: "3.7",
        highlights: emptyDoc(),
      },
    ],
    projects: [
      {
        name: "intro-builder",
        role: "核心开发",
        location: "深圳",
        start: "2024.04",
        end: "2024.06",
        stack: ["React", "Next.js"],
        link: "https://intro.dev",
        content: richDoc("支持多模板"),
      },
    ],
    sectionOrder: ["experience", "education", "projects"],
  });

  it.each(templates)("renders city on the right side for $id", ({ id, locationSelector }) => {
    const { container } = render_({
      html: itemFieldsFixtureHtml(locationSelector.slice(1), `${id}-item-meta`),
      css: ".fixture-item { display: grid; }",
      content,
      templateId: id,
    });

    const locations = Array.from(container.querySelectorAll(locationSelector)).map((el) =>
      el.textContent?.trim(),
    );
    expect(locations).toEqual(["北京", "广州", "深圳"]);
  });

  it.each(templates)("renders project stack and link without mixing city into meta for $id", ({ id, metaSelector }) => {
    const { container } = render_({
      html: itemFieldsFixtureHtml(`${id}-item-location`, metaSelector.slice(1)),
      css: ".fixture-item { display: grid; }",
      content,
      templateId: id,
    });

    const metaText = Array.from(container.querySelectorAll(metaSelector))
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(metaText).toContain("React · Next.js");
    expect(metaText).toContain("https://intro.dev");
    expect(metaText).not.toContain("深圳");
    expect(metaText).not.toContain("广州");
  });

});

describe("SlotRenderer — basics 头部自动补 data-pagination-header", () => {
  // 回归：除 professional 外的模板用裸 <header>，PDF 导出
  // `header:not([data-pagination-header]){display:none}` 会把整块个人信息隐藏。
  // 引擎层自动补标记，所有模板的 basics 头部都能在导出时保留。
  it("裸 <header> 渲染后带 data-pagination-header", () => {
    const { container } = render_({
      html: '<article><header><h1><slot data-bind="basics.name" /></h1></header></article>',
    });
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.hasAttribute("data-pagination-header")).toBe(true);
  });

  it("已手写 data-pagination-header 时不重复（幂等）", () => {
    const { container } = render_({
      html: '<article><header data-pagination-header class="pro"><h1><slot data-bind="basics.name" /></h1></header></article>',
    });
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.getAttribute("class")).toBe("pro");
    expect(header!.hasAttribute("data-pagination-header")).toBe(true);
  });

  it("basics 用 <div>（无 <header>）时不报错且正常渲染", () => {
    const { container } = render_({
      html: '<article><div class="basics"><h1><slot data-bind="basics.name" /></h1></div></article>',
    });
    expect(container.querySelector("header")).toBeNull();
    expect(container.textContent).toContain("张三");
  });
});

describe("SlotRenderer — basics 头部自动补 data-pagination-header", () => {
  // 回归：除 professional 外的模板用裸 <header>，PDF 导出
  // `header:not([data-pagination-header]){display:none}` 会把整块个人信息隐藏。
  // 引擎层自动补标记，所有模板的 basics 头部都能在导出时保留。
  it("裸 <header> 渲染后带 data-pagination-header", () => {
    const { container } = render_({
      html: '<article><header><h1><slot data-bind="basics.name" /></h1></header></article>',
    });
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.hasAttribute("data-pagination-header")).toBe(true);
  });

  it("已手写 data-pagination-header 时不重复（幂等）", () => {
    const { container } = render_({
      html: '<article><header data-pagination-header class="pro"><h1><slot data-bind="basics.name" /></h1></header></article>',
    });
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.getAttribute("class")).toBe("pro");
    expect(header!.hasAttribute("data-pagination-header")).toBe(true);
  });

  it("basics 用 <div>（无 <header>）时不报错且正常渲染", () => {
    const { container } = render_({
      html: '<article><div class="basics"><h1><slot data-bind="basics.name" /></h1></div></article>',
    });
    expect(container.querySelector("header")).toBeNull();
    expect(container.textContent).toContain("张三");
  });
});
