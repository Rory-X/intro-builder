import { describe, expect, it } from "vitest";
import { findSmartLayoutMeasurementContainer } from "@/hooks/use-smart-layout";

describe("findSmartLayoutMeasurementContainer", () => {
  it("finds the hidden measurement container from the forwarded visible preview ref", () => {
    document.body.innerHTML = `
      <div data-paginated-preview-root>
        <div aria-hidden="true" data-measurement="yes"></div>
        <div>
          <div data-testid="resume-export-preview"></div>
        </div>
      </div>
    `;

    const visiblePreview = document.querySelector("[data-testid='resume-export-preview']") as HTMLElement;

    expect(findSmartLayoutMeasurementContainer(visiblePreview)).toHaveAttribute(
      "data-measurement",
      "yes",
    );
  });

  it("returns null instead of searching unrelated ancestors", () => {
    document.body.innerHTML = `
      <div aria-hidden="true" data-measurement="wrong"></div>
      <div>
        <div data-testid="resume-export-preview"></div>
      </div>
    `;

    const visiblePreview = document.querySelector("[data-testid='resume-export-preview']") as HTMLElement;

    expect(findSmartLayoutMeasurementContainer(visiblePreview)).toBeNull();
  });
});
