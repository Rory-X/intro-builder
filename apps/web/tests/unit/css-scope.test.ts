import { describe, it, expect } from "vitest";
import { scopeCss, CssScopeError } from "@/lib/templates/uploaded/css-scope";

describe("scopeCss — happy path", () => {
  it("prepends scope to single class selector", () => {
    expect(scopeCss(".foo { color: red }", "tpl1")).toBe(
      `[data-template-id="tpl1"] .foo { color: red }`,
    );
  });

  it("handles multi-selector comma list", () => {
    expect(scopeCss(".a, .b { color: red }", "tpl1")).toBe(
      `[data-template-id="tpl1"] .a, [data-template-id="tpl1"] .b { color: red }`,
    );
  });

  it("preserves CSS variables in body", () => {
    expect(scopeCss(".foo { font-size: var(--font-size) }", "tpl1")).toContain(
      "var(--font-size)",
    );
  });

  it("scopes descendant selector", () => {
    expect(scopeCss(".card .header { color: blue }", "tpl1")).toBe(
      `[data-template-id="tpl1"] .card .header { color: blue }`,
    );
  });

  it("allows id selector at head", () => {
    expect(scopeCss("#main { padding: 24px }", "tpl1")).toBe(
      `[data-template-id="tpl1"] #main { padding: 24px }`,
    );
  });

  it("allows element-only selector NOT at chain head (descendant ok)", () => {
    // `.card p` is fine — `.card` qualifies the chain head, p is descendant
    expect(scopeCss(".card p { line-height: 1.6 }", "tpl1")).toBe(
      `[data-template-id="tpl1"] .card p { line-height: 1.6 }`,
    );
  });

  it("allows pseudo-class on class selector", () => {
    expect(scopeCss(".btn:hover { opacity: 0.8 }", "tpl1")).toBe(
      `[data-template-id="tpl1"] .btn:hover { opacity: 0.8 }`,
    );
  });

  it("returns empty string for empty input", () => {
    expect(scopeCss("", "tpl1")).toBe("");
    expect(scopeCss("   ", "tpl1")).toBe("");
  });
});

describe("scopeCss — forbidden constructs throw", () => {
  it("throws on @media", () => {
    expect(() => scopeCss("@media (min-width: 600px) { .foo {} }", "tpl1")).toThrow(
      CssScopeError,
    );
  });

  it("throws on @keyframes", () => {
    expect(() => scopeCss("@keyframes spin { from {} to {} }", "tpl1")).toThrow(
      CssScopeError,
    );
  });

  it("throws on @supports", () => {
    expect(() =>
      scopeCss("@supports (display: grid) { .foo {} }", "tpl1"),
    ).toThrow(CssScopeError);
  });

  it("throws on @import", () => {
    expect(() => scopeCss(`@import url("main.css");`, "tpl1")).toThrow(
      CssScopeError,
    );
  });

  it("throws on @font-face", () => {
    expect(() =>
      scopeCss(`@font-face { font-family: "X"; src: url("x.woff2") }`, "tpl1"),
    ).toThrow(CssScopeError);
  });

  it("throws on universal selector at chain head", () => {
    expect(() => scopeCss("* { box-sizing: border-box }", "tpl1")).toThrow(
      CssScopeError,
    );
  });

  it("throws on bare element selector at chain head", () => {
    expect(() => scopeCss("body { background: red }", "tpl1")).toThrow(
      CssScopeError,
    );
    expect(() => scopeCss("section { padding: 24px }", "tpl1")).toThrow(
      CssScopeError,
    );
    expect(() => scopeCss("p { line-height: 1.6 }", "tpl1")).toThrow(
      CssScopeError,
    );
  });
});

describe("scopeCss — templateId escaping", () => {
  it("escapes double quotes in templateId", () => {
    expect(scopeCss(".foo { color: red }", `te"st`)).toBe(
      `[data-template-id="te\\"st"] .foo { color: red }`,
    );
  });
});
