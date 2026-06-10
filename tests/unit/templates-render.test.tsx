import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import { TemplateRender } from "@/lib/templates/render-server";
import * as registryServer from "@/lib/templates/registry-server";
import { demoResume } from "@/lib/demo-resume";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

describe("ClientTemplateRenderFromSerializable", () => {
  it("renders SlotRenderer when source=unified", () => {
    const { container } = render(
      <ClientTemplateRenderFromSerializable
        resolved={{
          source: "unified",
          id: "test-x",
          html: '<div class="test"><slot data-bind="basic.name"></slot></div>',
          css: null,
          templateId: "test-x",
          sectionIcons: {},
        }}
        content={demoResume}
      />,
    );
    expect(container.textContent).toContain(demoResume.basics.name);
  });
});

describe("TemplateRender (server) preResolved short-circuit", () => {
  it("does NOT call getTemplateMetaAsync when preResolved is provided", async () => {
    const spy = vi.spyOn(registryServer, "getTemplateMetaAsync");
    const tpl: UploadedTemplate = {
      id: "professional",
      name: "Professional",
      description: null,
      thumbnailUrl: null,
      sectionIcons: {},
      html: '<div><slot data-bind="basic.name"></slot></div>',
      css: null,
      category: null,
      features: null,
    };
    await TemplateRender({
      id: "professional",
      preResolved: { source: "uploaded", id: "professional", template: tpl },
      content: demoResume,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("throws when template has no HTML", async () => {
    const tpl: UploadedTemplate = {
      id: "no-html",
      name: "NoHTML",
      description: null,
      thumbnailUrl: null,
      sectionIcons: {},
      html: null,
      css: null,
      category: null,
      features: null,
    };
    await expect(
      TemplateRender({
        id: "no-html",
        preResolved: { source: "uploaded", id: "no-html", template: tpl },
        content: demoResume,
      }),
    ).rejects.toThrow(/no HTML content/);
  });
});
