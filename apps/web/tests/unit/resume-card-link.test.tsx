import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResumeCardLink } from "@/app/(app)/dashboard/resume-card-link";

describe("ResumeCardLink", () => {
  it("shows loading feedback immediately after click", () => {
    render(
      <ResumeCardLink href="/resume/r1/edit">
        <div>简历预览</div>
      </ResumeCardLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: /简历预览/ }));

    expect(screen.getByText("打开中…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /简历预览/ })).toHaveAttribute("aria-busy", "true");
  });
});
