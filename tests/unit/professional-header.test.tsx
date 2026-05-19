import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfessionalHeader } from "@/lib/templates/shared/professional-header";
import type { ResumeContent } from "@/lib/resume-schema";

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
  it("renders a 3-column contact row under the name", () => {
    const { container } = render(<ProfessionalHeader basics={basics} />);
    const contactRow = container.querySelectorAll("tbody tr")[1];
    const cells = contactRow?.querySelectorAll("td");
    expect(cells).toHaveLength(3);
    expect(cells?.[0]?.textContent).toContain("15814941308");
    expect(cells?.[0]?.textContent).toContain("广州");
    expect(cells?.[1]?.textContent).toMatch(/个人知识库：space\.ly57\.cn/);
    expect(cells?.[2]?.textContent).toContain("jiahqian@gmail.com");
    expect(cells?.[2]?.textContent).toContain("前端开发实习生");
    expect(screen.getByRole("heading", { name: "钱嘉豪" })).toBeTruthy();
  });

  it("vertically centers the website in the middle column", () => {
    const { container } = render(<ProfessionalHeader basics={basics} />);
    const middle = container.querySelectorAll("tbody tr")[1]?.querySelectorAll("td")[1];
    expect(middle?.className).toContain("align-middle");
  });
});
