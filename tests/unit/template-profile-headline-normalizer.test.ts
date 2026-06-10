import { describe, expect, it } from "vitest";
import {
  checkProfileHeadlineHtml,
  normalizeProfileHeadlineHtml,
} from "@/lib/templates/uploaded/profile-headline-normalizer";

describe("profile headline normalizer", () => {
  it("moves status out of the contact row into the title headline and removes the clock icon", () => {
    const html = `
      <header>
        <h1><slot data-bind="basics.name"></slot></h1>
        <p class="job-title"><slot data-bind="basics.title"></slot></p>
        <div class="contact-row">
          <span class="contact-item"><slot data-bind="basics.icon.Clock"></slot><slot data-bind="basics.status"></slot></span>
          <span class="contact-item"><slot data-bind="basics.email"></slot></span>
        </div>
      </header>
    `;

    const normalized = normalizeProfileHeadlineHtml(html);

    expect(normalized).toContain('data-bind="profile.title"');
    expect(normalized).toContain('class="profile-status"');
    expect(normalized).toContain('data-bind="profile.status"');
    expect(normalized).not.toContain("basics.icon.Clock");
    expect(normalized.indexOf("profile.title")).toBeLessThan(
      normalized.indexOf("profile.status"),
    );
    expect(checkProfileHeadlineHtml(normalized)).toEqual([]);
  });

  it("deduplicates existing inline status and rewrites the headline to the canonical wrapper", () => {
    const html = `
      <header>
        <h1><slot data-bind="profile.name"></slot></h1>
        <div class="title-line">
          <slot data-bind="basics.title"></slot>
          <span class="sep">·</span>
          <slot data-bind="basics.status"></slot>
        </div>
      </header>
    `;

    const normalized = normalizeProfileHeadlineHtml(html);

    expect(normalized.match(/data-bind="profile\.status"/g)).toHaveLength(1);
    expect(normalized).not.toContain('data-bind="basics.status"');
    expect(normalized).not.toContain('class="sep"');
    expect(checkProfileHeadlineHtml(normalized)).toEqual([]);
  });

  it("removes duplicate separators left behind by the old status contact item", () => {
    const html = `
      <div class="contact-line">
        <span class="contact-item"><slot data-bind="basics.title"></slot></span>
        <span class="contact-sep">·</span>
        <span class="contact-item"><slot data-bind="basics.icon.Clock"></slot><slot data-bind="basics.status"></slot></span>
        <span class="contact-sep">·</span>
        <span class="contact-item"><slot data-bind="basics.phone"></slot></span>
        <span class="contact-sep">·</span>
        <span class="contact-item"><slot data-bind="basics.email"></slot></span>
      </div>
    `;

    const normalized = normalizeProfileHeadlineHtml(html);

    expect(normalized).toContain('class="profile-status"');
    expect(normalized.match(/contact-sep/g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(normalized).toContain('data-bind="basics.phone"');
    expect(normalized).toContain('data-bind="basics.email"');
    expect(normalized).not.toContain("basics.icon.Clock");
    expect(checkProfileHeadlineHtml(normalized)).toEqual([]);
  });

  it("reports duplicate status and clock icons before normalization", () => {
    const html = `
      <header>
        <div><slot data-bind="basics.title"></slot><slot data-bind="basics.status"></slot></div>
        <div><slot data-bind="basics.icon.Clock"></slot><slot data-bind="basics.status"></slot></div>
      </header>
    `;

    expect(checkProfileHeadlineHtml(html)).toEqual(
      expect.arrayContaining([
        "duplicate-status",
        "status-clock-icon",
      ]),
    );
  });
});
