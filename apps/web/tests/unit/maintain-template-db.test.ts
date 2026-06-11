import { describe, expect, it } from "vitest";
import type { DbTemplate } from "@/db/schema";
import { patchTemplate } from "../../../../scripts/maintain-template-db";

function templateRow(overrides: Partial<DbTemplate>): DbTemplate {
  return {
    id: "fixture",
    name: "Fixture",
    description: null,
    thumbnailUrl: null,
    category: "general",
    features: null,
    html: null,
    css: null,
    sectionIcons: null,
    defaultStyleSettings: null,
    bannerImageUrl: null,
    isDefault: false,
    status: "published",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("maintain-template-db patchTemplate", () => {
  it("migrates legacy contact slots in place without dropping icon sizing or title lines", () => {
    const patch = patchTemplate(templateRow({
      id: "abbey-blue",
      html: `
        <article class="abbey-blue-page">
          <header class="abbey-blue-banner">
            <img data-bind="basics.photo" class="abbey-blue-avatar" alt="头像" />
            <h1 class="abbey-blue-name"><slot data-bind="basics.name"></slot></h1>
            <div class="abbey-blue-subtitle">
              <slot data-bind="profile.title"></slot>
              <span class="profile-status"><span class="profile-sep"> · </span><slot data-bind="profile.status"></slot></span>
            </div>
            <div class="abbey-blue-contact">
              <span class="contact-item"><slot data-bind="basics.icon.Phone" class="contact-icon-lucide"></slot><slot data-bind="basics.phone"></slot></span>
              <span class="sep">|</span>
              <span class="contact-item"><slot data-bind="basics.icon.Mail" class="contact-icon-lucide"></slot><slot data-bind="basics.email"></slot></span>
            </div>
          </header>
          <main><slot data-bind="sectionOrder" data-template="section"></slot></main>
        </article>
        <template id="section-list">
          <section class="abbey-blue-section">
            <div class="abbey-blue-section-title">
              <div class="line"></div>
              <h2><slot data-bind="section.title"></slot></h2>
              <div class="line"></div>
            </div>
            <slot data-bind="section.items" data-template="item"></slot>
          </section>
        </template>
        <template id="section-block">
          <section class="abbey-blue-section">
            <div class="abbey-blue-section-title">
              <div class="line"></div>
              <h2><slot data-bind="section.title"></slot></h2>
              <div class="line"></div>
            </div>
            <div class="section-body"><slot data-bind="section.body"></slot></div>
          </section>
        </template>
      `,
      css: ".abbey-blue-section-title .line { height: 1px; }",
    }));

    expect(patch?.html).toContain('<div class="abbey-blue-contact">');
    expect(patch?.html).toContain('data-bind="profile.contacts" data-template="contact-item"');
    expect(patch?.html).not.toContain('<div class="contact-bar">');
    expect(patch?.html).toContain('data-bind="contact.icon" class="contact-icon-lucide"');
    expect(patch?.html).toContain('<div class="line"></div>');
    expect(patch?.html).not.toMatch(/data-bind=["'](?:basics|profile)\.(?:photo|name|title|status|email|phone|location|website|icon\.)/);
  });

  it("keeps template-specific item markup instead of replacing it with the crimson layout", () => {
    const patch = patchTemplate(templateRow({
      html: `
        <article><slot data-bind="sectionOrder" data-template="section"></slot></article>
        <template id="section-list">
          <section><slot data-bind="section.items" data-template="item"></slot></section>
        </template>
        <template id="section-block">
          <section><div class="section-body"><slot data-bind="section.body"></slot></div></section>
        </template>
        <template id="item">
          <div class="custom-entry">
            <div class="custom-entry-title"><slot data-bind="item.title"></slot></div>
            <div class="custom-entry-meta"><slot data-bind="item.meta"></slot><a class="item-link"><slot data-bind="item.link"></slot></a></div>
            <div class="custom-entry-location"><slot data-bind="item.location"></slot></div>
          </div>
        </template>
      `,
      css: ".custom-entry-title { font-weight: 700; }",
    }));

    expect(patch?.html).toContain("custom-entry-title");
    expect(patch?.html).not.toContain("item-header");
    expect(patch?.html).not.toContain("item-meta-row");
  });

  it("moves status out of legacy contact rows and keeps it beside the title without an icon", () => {
    const patch = patchTemplate(templateRow({
      id: "developer-code",
      html: `
        <article>
          <header class="tpl-header">
            <h1 class="name"><slot data-bind="basics.name"></slot></h1>
            <p class="job-title"><slot data-bind="basics.title"></slot></p>
            <div class="contact-row">
              <span class="contact-item"><slot data-bind="basics.icon.Clock" class="contact-icon-lucide"></slot><slot data-bind="basics.status"></slot></span>
              <span class="contact-item"><slot data-bind="basics.icon.Mail" class="contact-icon-lucide"></slot><slot data-bind="basics.email"></slot></span>
            </div>
          </header>
          <slot data-bind="sectionOrder" data-template="section"></slot>
        </article>
        <template id="section-list"><section><slot data-bind="section.items" data-template="item"></slot></section></template>
        <template id="section-block"><section><div class="section-body"><slot data-bind="section.body"></slot></div></section></template>
        <template id="item">
          <div><slot data-bind="item.title"></slot><slot data-bind="item.dateRange"></slot><slot data-bind="item.subtitle"></slot><slot data-bind="item.location"></slot><slot data-bind="item.meta"></slot><slot data-bind="item.link"></slot><slot data-bind="item.bullets"></slot></div>
        </template>
      `,
      css: ".job-title { color: #333; }",
    }));

    const html = patch?.html ?? "";
    const titleIndex = html.indexOf('data-bind="basic.title"');
    const statusIndex = html.indexOf('data-bind="basic.status"');
    const contactsIndex = html.indexOf('data-bind="profile.contacts"');

    expect(titleIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(titleIndex);
    expect(statusIndex).toBeLessThan(contactsIndex);
    expect(html).not.toContain("basics.icon.Clock");
    expect(html).not.toContain('data-bind="contact.icon" class="contact-icon-lucide"></slot><slot data-bind="basic.status"');
  });
});
