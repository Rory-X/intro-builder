import { describe, it, expect } from "vitest";
import { UploadedTemplate, type LayoutConfig } from "@/lib/templates/uploaded/types";

const minimalLayout: LayoutConfig = {
  frame: { kind: "vertical" },
  headerVariant: "professional",
  sectionTitleVariant: "professional",
  itemHeaderVariant: "professional",
  theme: { primaryColor: "#000000" },
  sectionIcons: {},
};

const baseV1Row = {
  id: "test-v1",
  name: "Test v1",
  description: null,
  thumbnailUrl: null,
  decoration: null,
  layout: minimalLayout,
  category: null,
  features: null,
};

describe("UploadedTemplate Zod schema (v1 / v2 shape coexistence)", () => {
  it("accepts v1 shape with customHtml=null + customCss=null", () => {
    const r = UploadedTemplate.safeParse({
      ...baseV1Row,
      customHtml: null,
      customCss: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts v2 shape with customHtml + customCss strings", () => {
    const r = UploadedTemplate.safeParse({
      ...baseV1Row,
      customHtml: '<article><h1><slot data-bind="basics.name" /></h1></article>',
      customCss: ".my-section { padding: 24px }",
    });
    expect(r.success).toBe(true);
  });

  it("accepts hybrid shape (customHtml present but customCss null)", () => {
    // Skill v2 may write HTML without CSS (relying on inline class names).
    const r = UploadedTemplate.safeParse({
      ...baseV1Row,
      customHtml: "<article></article>",
      customCss: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects when customHtml field is absent (must be nullable, not optional)", () => {
    // Field omission is different from null — DB read path always supplies
    // both columns (null when empty), so the schema must REQUIRE the keys.
    const { customHtml: _h, customCss: _c, ...withoutKeys } = {
      ...baseV1Row,
      customHtml: null,
      customCss: null,
    };
    const r = UploadedTemplate.safeParse(withoutKeys);
    expect(r.success).toBe(false);
  });

  it("rejects when customHtml is a non-string non-null value", () => {
    const r = UploadedTemplate.safeParse({
      ...baseV1Row,
      customHtml: 123,
      customCss: null,
    });
    expect(r.success).toBe(false);
  });
});
