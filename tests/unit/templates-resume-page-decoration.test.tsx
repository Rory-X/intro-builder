import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ResumePage } from "@/lib/templates/shared/resume-page";

describe("ResumePage decoration", () => {
  it("renders no decoration img when prop is undefined (backward compat)", () => {
    const { container } = render(
      <ResumePage>
        <div>content</div>
      </ResumePage>
    );
    expect(container.querySelector("img[data-template-decoration]")).toBeNull();
  });

  it("renders an absolute-positioned img when decoration is provided", () => {
    const { container } = render(
      <ResumePage
        decoration={{
          bgImageUrl: "https://example.com/abbey-bg.png",
          placement: {
            position: "absolute",
            top: "0",
            right: "0",
            width: "40%",
            height: "auto",
            zIndex: 0,
            opacity: 1,
          },
        }}
      >
        <div>content</div>
      </ResumePage>
    );
    const img = container.querySelector("img[data-template-decoration]") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("https://example.com/abbey-bg.png");
    expect(img.style.position).toBe("absolute");
    expect(img.style.right).toBe("0px");
  });

  it("applies pageBgColor to the article background when provided", () => {
    const { container } = render(
      <ResumePage
        decoration={{
          bgImageUrl: "x",
          placement: { position: "absolute", top: "0", right: "0", width: "0", height: "0", zIndex: 0, opacity: 1 },
          pageBgColor: "#eef3f6",
        }}
      >
        <div />
      </ResumePage>
    );
    const article = container.querySelector("article")!;
    expect(article.style.backgroundColor).toBe("rgb(238, 243, 246)");
  });

  it("merges custom style prop onto the article (e.g. CSS variables)", () => {
    const { container } = render(
      <ResumePage style={{ "--primary": "#137880" } as React.CSSProperties}>
        <div />
      </ResumePage>
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.getPropertyValue("--primary")).toBe("#137880");
  });

  it("custom style prop does not override existing structural styles", () => {
    const { container } = render(
      <ResumePage style={{ fontSize: "999px" }}>
        <div />
      </ResumePage>
    );
    const article = container.querySelector("article") as HTMLElement;
    // Structural fontSize from styleSettings wins
    expect(article.style.fontSize).not.toBe("999px");
  });
});
