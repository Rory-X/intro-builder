import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import { TemplateRender } from "@/lib/templates/render-server";
import * as registryServer from "@/lib/templates/registry-server";
import { TEMPLATES } from "@/lib/templates/registry";
import { demoResume } from "@/lib/demo-resume";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

describe("ClientTemplateRenderFromSerializable", () => {
  it("renders built-in Layout when source=builtin", () => {
    const { container } = render(
      <ClientTemplateRenderFromSerializable
        resolved={{ source: "builtin", id: "professional" }}
        content={demoResume}
      />,
    );
    // Built-in templates render the candidate name
    expect(container.textContent).toContain(demoResume.basics.name);
  });

  it("renders UploadedLayout when source=uploaded", () => {
    const tpl: UploadedTemplate = {
      id: "test-x",
      name: "T",
      description: null,
      thumbnailUrl: null,
      decoration: null,
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
    const { container } = render(
      <ClientTemplateRenderFromSerializable
        resolved={{ source: "uploaded", id: "test-x", template: tpl }}
        content={demoResume}
      />,
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--primary")).toBe("#137880");
  });

  it("falls back to first built-in for unknown built-in id", () => {
    const { container } = render(
      <ClientTemplateRenderFromSerializable
        resolved={{ source: "builtin", id: "no-such-id" as never }}
        content={demoResume}
      />,
    );
    expect(container.textContent).toContain(demoResume.basics.name);
  });
});

describe("TemplateRender (server) preResolved short-circuit", () => {
  it("does NOT call getTemplateMetaAsync when preResolved is provided", async () => {
    const spy = vi.spyOn(registryServer, "getTemplateMetaAsync");
    const builtinMeta = TEMPLATES.find((t) => t.id === "professional")!;
    // Awaiting an async server component returns the JSX it would render —
    // we don't need to mount it to assert the short-circuit, just verify
    // the DB-touching async resolver was never invoked.
    await TemplateRender({
      id: "professional",
      preResolved: { source: "builtin", id: "professional", meta: builtinMeta },
      content: demoResume,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("dispatches uploaded preResolved to UploadedLayout (regression: dashboard / pdf used to fall back to builtin for uploaded ids)", async () => {
    const tpl: UploadedTemplate = {
      id: "uploaded-x",
      name: "Custom",
      description: null,
      thumbnailUrl: null,
      decoration: null,
      layout: {
        frame: { kind: "vertical" },
        headerVariant: "professional",
        sectionTitleVariant: "professional",
        itemHeaderVariant: "professional",
        theme: { primaryColor: "#abcdef" },
        sectionIcons: {},
      },
      customHtml: null,
      customCss: null,
      category: null,
      features: null,
    };
    const element = await TemplateRender({
      id: "uploaded-x",
      preResolved: { source: "uploaded", id: "uploaded-x", template: tpl },
      content: demoResume,
    });
    const { container } = render(element);
    // UploadedLayout pipes layout.theme.primaryColor onto article via --primary;
    // a builtin fallback would not carry the same custom value through.
    const article = container.querySelector("article");
    expect(article?.style.getPropertyValue("--primary")).toBe("#abcdef");
  });
});
