import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarketingNav } from "@/components/marketing/marketing-nav";

describe("MarketingNav", () => {
  it("opens a mobile menu with the landing navigation links", () => {
    render(<MarketingNav />);

    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }));

    expect(screen.getAllByText("产品功能").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("模板").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("求职文档").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("博客").length).toBeGreaterThanOrEqual(1);
  });

  it("hides the mobile menu outside the landing page", () => {
    render(<MarketingNav hideNavLinks />);

    expect(screen.queryByRole("button", { name: "打开导航菜单" })).not.toBeInTheDocument();
    expect(screen.queryByText("产品功能")).not.toBeInTheDocument();
    expect(screen.queryByText("求职文档")).not.toBeInTheDocument();
  });
});
