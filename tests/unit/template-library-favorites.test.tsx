import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { TemplateLibraryClient } from "@/app/(app)/templates/template-library-client";
import { demoResume } from "@/lib/demo-resume";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

// server actions 全 mock，测试只关心 UI 行为（点星调用、乐观变黄、筛选）。
vi.mock("@/app/(app)/templates/actions", () => ({
  toggleTemplateFavorite: vi.fn().mockResolvedValue({ success: true }),
  getFavoriteTemplateIds: vi.fn(),
}));
vi.mock("@/app/(app)/resume/[id]/edit/actions", () => ({
  setTemplate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toggleTemplateFavorite } from "@/app/(app)/templates/actions";

// jsdom 缺 IntersectionObserver / ResizeObserver —— TemplateThumbnail 用到它们。
class MockObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
  root = null;
  rootMargin = "";
  thresholds = [];
  constructor(_cb: unknown) {
    void _cb;
  }
}

const professionalName = "专业";
const modernName = "现代";

const templates: SerializableResolvedTemplate[] = [
  {
    source: "unified",
    id: "professional",
    templateId: "professional",
    html: '<main><slot data-bind="basics.name"></slot></main>',
    css: null,
    sectionIcons: {},
    name: professionalName,
    description: "单栏清晰",
    category: "tech",
  },
  {
    source: "unified",
    id: "modern",
    templateId: "modern",
    html: '<main><slot data-bind="basics.name"></slot></main>',
    css: null,
    sectionIcons: {},
    name: modernName,
    description: "技术风双栏",
    category: "tech",
  },
];

function renderLibrary(favoritedIds: string[]) {
  return render(
    <TemplateLibraryClient
      templates={templates}
      userResume={null}
      demoResume={demoResume}
      favoritedIds={favoritedIds}
    />,
  );
}

describe("TemplateLibraryClient — 收藏", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", MockObserver);
    vi.stubGlobal("ResizeObserver", MockObserver);
  });

  it("初始收藏状态来自 favoritedIds：已收藏星 aria-pressed=true", () => {
    renderLibrary(["professional"]);
    expect(
      screen.getByRole("button", { name: `取消收藏 ${professionalName}` }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: `收藏 ${modernName}` }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("点未收藏的星：调 toggleTemplateFavorite(id,true) 且乐观翻转", () => {
    renderLibrary([]);
    const star = screen.getByRole("button", { name: `收藏 ${modernName}` });
    fireEvent.click(star);
    expect(toggleTemplateFavorite as unknown as Mock).toHaveBeenCalledWith(
      "modern",
      true,
    );
    // 乐观更新：立即变成"取消收藏"态
    expect(
      screen.getByRole("button", { name: `取消收藏 ${modernName}` }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("「我收藏的」筛选只显示已收藏的模板", () => {
    renderLibrary(["professional"]);
    // 切到收藏 tab
    fireEvent.click(screen.getByRole("tab", { name: /我收藏的/ }));
    // professional 在，modern 不在
    expect(screen.getByText(professionalName)).toBeInTheDocument();
    expect(screen.queryByText(modernName)).toBeNull();
  });

  it("收藏 tab 计数随收藏数变化", () => {
    renderLibrary(["professional"]);
    expect(screen.getByRole("tab", { name: /我收藏的 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `收藏 ${modernName}` }));
    expect(screen.getByRole("tab", { name: /我收藏的 2/ })).toBeInTheDocument();
  });
});
