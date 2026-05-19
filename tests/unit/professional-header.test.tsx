import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfessionalLayout } from "@/lib/templates/professional/Layout";
import { ProfessionalHeader } from "@/lib/templates/shared/professional-header";
import { emptyResumeContent, type ResumeContent } from "@/lib/resume-schema";

const basics: ResumeContent["basics"] = {
  name: "钱嘉豪",
  status: "",
  title: "前端开发实习生",
  email: "jiahqian@gmail.com",
  phone: "15814941308",
  location: "广州",
  website: "space.ly57.cn",
  summary: "",
  photo: "",
};

describe("ProfessionalHeader", () => {
  it("renders centered, no-wrap contact rows under the name", () => {
    render(<ProfessionalHeader basics={basics} />);
    const contactBlock = screen.getByTestId("professional-contact-block");
    const rows = contactBlock.querySelectorAll("[data-testid='contact-row']");
    expect(contactBlock.className).toContain("mx-auto");
    expect(contactBlock.className).toContain("max-w-[32em]");
    expect(rows).toHaveLength(3);

    expect(rows[0]?.textContent).toContain("15814941308");
    expect(rows[0]?.textContent).toContain("jiahqian@gmail.com");
    expect(rows[0]?.className).toContain("justify-center");
    expect(rows[1]?.textContent).toMatch(/个人知识库：space\.ly57\.cn/);
    expect(rows[1]?.className).toContain("justify-center");
    expect(rows[2]?.textContent).toContain("广州");
    expect(rows[2]?.textContent).toContain("前端开发实习生");
    expect(rows[2]?.className).toContain("justify-center");
    contactBlock.querySelectorAll("[data-testid='contact-chip']").forEach((chip) => {
      expect(chip.className).toContain("whitespace-nowrap");
    });
    expect(screen.getByRole("heading", { name: "钱嘉豪" })).toBeTruthy();
  });

  it("centers the website row", () => {
    const { container } = render(<ProfessionalHeader basics={basics} />);
    const websiteRow = container
      .querySelector("[data-testid='professional-contact-block']")
      ?.querySelectorAll("[data-testid='contact-row']")[1];
    expect(websiteRow?.className).toContain("justify-center");
  });

  it("does not render the summary section in the professional template", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      basics: { ...basics, summary: "11" },
      sectionOrder: ["basics"],
    };

    const { container } = render(<ProfessionalLayout content={content} showEmptyPlaceholders />);
    expect(container.querySelector("header")?.textContent).not.toContain("11");
    expect(screen.queryByRole("heading", { name: "自我介绍" })).not.toBeInTheDocument();
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  it("does not render a divider under the professional header", () => {
    const content: ResumeContent = {
      ...emptyResumeContent(),
      basics,
      sectionOrder: ["projects"],
    };

    const { container } = render(<ProfessionalLayout content={content} showEmptyPlaceholders />);
    expect(container.querySelector("header .border-b")).not.toBeInTheDocument();
  });
});
