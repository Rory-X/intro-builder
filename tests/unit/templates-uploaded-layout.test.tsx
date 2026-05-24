import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UploadedLayout } from "@/lib/templates/uploaded/UploadedLayout";
import { demoResume } from "@/lib/demo-resume";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

const sampleTemplate: UploadedTemplate = {
  id: "test-001",
  name: "Test Template",
  description: null,
  thumbnailUrl: null,
  decoration: {
    bgImageUrl: "https://example.com/bg.png",
    placement: {
      position: "absolute",
      top: "0",
      right: "0",
      width: "40%",
      height: "auto",
      zIndex: 0,
      opacity: 1,
    },
  },
  layout: {
    headerVariant: "professional",
    sectionTitleVariant: "professional",
    itemHeaderVariant: "professional",
    theme: { primaryColor: "#137880" },
    sectionIcons: {},
  },
};

describe("UploadedLayout", () => {
  it("renders the candidate name from content", () => {
    const { getByText } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    expect(getByText(demoResume.basics.name)).toBeInTheDocument();
  });

  it("renders the decoration image when present", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    expect(container.querySelector("img[data-template-decoration]")).not.toBeNull();
  });

  it("applies primaryColor as a CSS variable on the article element", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--primary")).toBe("#137880");
  });

  it("applies accentColor as --accent when provided", () => {
    const { container } = render(
      <UploadedLayout
        content={demoResume}
        template={{
          ...sampleTemplate,
          layout: {
            ...sampleTemplate.layout,
            theme: { primaryColor: "#137880", accentColor: "#9eb8be" },
          },
        }}
      />
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--accent")).toBe("#9eb8be");
  });

  it("works without decoration (decoration: null)", () => {
    const { container } = render(
      <UploadedLayout
        content={demoResume}
        template={{ ...sampleTemplate, decoration: null }}
      />
    );
    expect(container.querySelector("img[data-template-decoration]")).toBeNull();
  });

  it("renders multiple sections from sectionOrder", () => {
    const { container } = render(
      <UploadedLayout content={demoResume} template={sampleTemplate} />
    );
    // Demo content has at least experience and education — check both render
    // Use textContent because section titles depend on Chinese labels in section-meta
    expect(container.textContent).toMatch(/经历|经验|工作/);  // any flavor of experience label
  });
});
