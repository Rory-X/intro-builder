import { describe, expect, it, vi } from "vitest";

describe("template-studio insert-template validation", () => {
  it("can be imported for validation without running the CLI", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as never);

    await expect(import("../../../../template-studio-skill/scripts/insert-template")).resolves.toHaveProperty(
      "checkTemplateProtocol",
    );
    expect(exit).not.toHaveBeenCalled();

    exit.mockRestore();
  });

  it("accepts the protocol class contract used by template-studio", async () => {
    const { checkTemplateProtocol } = await import("../../../../template-studio-skill/scripts/insert-template");

    expect(checkTemplateProtocol({
      html: `
        <article>
          <slot data-bind="profile.contacts" data-template="contact-item"></slot>
          <slot data-bind="sectionOrder" data-template="section"></slot>
        </article>
        <template id="contact-item">
          <a class="contact-item"><slot data-bind="contact.icon"></slot><slot data-bind="contact.label"></slot></a>
        </template>
        <template id="section-list">
          <section><slot data-bind="section.items" data-template="item"></slot></section>
        </template>
        <template id="section-block">
          <section><div class="section-body"><slot data-bind="section.body"></slot></div></section>
        </template>
        <template id="item">
          <div class="resume-item">
            <div class="item-header"><span class="item-title"><slot data-bind="item.title"></slot></span><span class="item-date"><slot data-bind="item.dateRange"></slot></span></div>
            <div class="item-subtitle"><span class="item-role"><slot data-bind="item.subtitle"></slot></span><span class="item-location"><slot data-bind="item.location"></slot></span></div>
            <div class="item-meta-row"><span class="item-meta"><slot data-bind="item.meta"></slot></span><a class="item-link"><slot data-bind="item.link"></slot></a></div>
            <div class="item-body"><slot data-bind="item.bullets"></slot></div>
          </div>
        </template>
      `,
      css: ".resume-item { margin-bottom: var(--item-gap); }.item-title { font-weight: 700; }",
    })).toEqual([]);
  });

  it("rejects private semantic item classes and renderer-owned CSS", async () => {
    const { checkTemplateProtocol } = await import("../../../../template-studio-skill/scripts/insert-template");

    const errors = checkTemplateProtocol({
      html: '<div class="pro-item-title"><slot data-bind="item.title"></slot></div>',
      css: `
        .entry-title { font-weight: 700; }
        /* intro-builder template db patch 2026-06 contact spacing: 联系方式各项之间留间距 + 去竖线分隔。 */
        .contact-item:not(:last-child) { margin-right: 0.9em; }
      `,
    });

    expect(errors).toContain("HTML uses private semantic class: pro-item-title");
    expect(errors).toContain("CSS uses private semantic selector: entry-title");
    expect(errors).toContain("CSS contains renderer-owned protocol CSS: contact spacing");
  });

  it("validates template default style settings against the app schema", async () => {
    const { parseDefaultStyleSettings } = await import("../../../../template-studio-skill/scripts/insert-template");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as never);

    expect(parseDefaultStyleSettings(JSON.stringify({
      fontFamily: "sans",
      fontSize: 12,
      lineHeight: 1.5,
      bodyLineHeight: 1.5,
      headingGap: 6,
      pagePadding: 32,
      sectionGap: 12,
      itemGap: 8,
      photoScale: 1,
    }))).toEqual({
      fontFamily: "sans",
      fontSize: 12,
      lineHeight: 1.5,
      bodyLineHeight: 1.5,
      headingGap: 6,
      pagePadding: 32,
      sectionGap: 12,
      itemGap: 8,
      photoScale: 1,
    });

    expect(() => parseDefaultStyleSettings(JSON.stringify({
      fontFamily: "sans",
      fontSize: 99,
      lineHeight: 1.5,
      bodyLineHeight: 1.5,
      headingGap: 6,
      pagePadding: 32,
      sectionGap: 12,
      itemGap: 8,
      photoScale: 1,
    }))).toThrow("process.exit 1");

    exit.mockRestore();
  });
});
