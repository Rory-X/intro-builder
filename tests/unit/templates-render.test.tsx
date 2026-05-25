import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
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
        headerVariant: "professional",
        sectionTitleVariant: "professional",
        itemHeaderVariant: "professional",
        theme: { primaryColor: "#137880" },
        sectionIcons: {},
      },
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
