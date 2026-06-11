import { describe, expect, it } from "vitest";
import { paginate, type PaginationItem } from "@/lib/pagination";

describe("paginate", () => {
  const PAGE_HEIGHT = 1000; // simplified for testing

  it("returns 1 page when all items fit", () => {
    const items: PaginationItem[] = [
      { key: "header", height: 100 },
      { key: "exp", height: 300, sectionId: "experience" },
      { key: "edu", height: 200, sectionId: "education" },
    ];
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(3);
    expect(pages[0].continuedSectionId).toBeUndefined();
  });

  it("returns 1 page when total height equals page height exactly", () => {
    const items: PaginationItem[] = [
      { key: "a", height: 500 },
      { key: "b", height: 500 },
    ];
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(1);
  });

  it("splits into 2 pages at section boundary", () => {
    const items: PaginationItem[] = [
      { key: "header", height: 100 },
      { key: "exp", height: 600, sectionId: "experience" },
      { key: "edu", height: 500, sectionId: "education" },
    ];
    // Total = 1200 > 1000. Exp fits on page 1 (100+600=700), edu goes to page 2.
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(2);
    expect(pages[0].items.map((i) => i.key)).toEqual(["header", "exp"]);
    expect(pages[1].items.map((i) => i.key)).toEqual(["edu"]);
  });

  it("splits long section by items", () => {
    const items: PaginationItem[] = [
      { key: "header", height: 100 },
      { key: "exp-title", height: 40, sectionId: "experience", isSectionHeader: true },
      { key: "exp-0", height: 300, sectionId: "experience" },
      { key: "exp-1", height: 300, sectionId: "experience" },
      { key: "exp-2", height: 300, sectionId: "experience" },
      { key: "exp-3", height: 300, sectionId: "experience" },
    ];
    // header(100) + title(40) + exp-0(300) + exp-1(300) = 740 fits
    // exp-2(300) → 1040 > 1000 → new page
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(2);
    expect(pages[0].items.map((i) => i.key)).toEqual(["header", "exp-title", "exp-0", "exp-1"]);
    expect(pages[1].items.map((i) => i.key)).toEqual(["exp-2", "exp-3"]);
    expect(pages[1].continuedSectionId).toBe("experience");
  });

  it("accounts for repeated section header on continuation page", () => {
    const items: PaginationItem[] = [
      { key: "header", height: 100 },
      { key: "exp-title", height: 50, sectionId: "experience", isSectionHeader: true },
      { key: "exp-0", height: 400, sectionId: "experience" },
      { key: "exp-1", height: 400, sectionId: "experience" },
      { key: "exp-2", height: 400, sectionId: "experience" },
    ];
    // Page 1: header(100) + title(50) + exp-0(400) + exp-1(400) = 950 ≤ 1000 ✓
    // Page 2: reserved title(50) + exp-2(400) = 450 ≤ 1000 ✓
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(2);
    expect(pages[1].continuedSectionId).toBe("experience");
    expect(pages[1].items.map((i) => i.key)).toEqual(["exp-2"]);
  });

  it("puts oversized item on its own page", () => {
    const items: PaginationItem[] = [
      { key: "header", height: 100 },
      { key: "giant", height: 1500, sectionId: "experience" },
      { key: "small", height: 200, sectionId: "education" },
    ];
    const pages = paginate(items, PAGE_HEIGHT);
    // header on page 1 (100 ≤ 1000), giant on page 2 (overflows but allowed),
    // small on page 3
    expect(pages.length).toBeGreaterThanOrEqual(2);
    // giant should be alone or with header depending on fit
    const giantPage = pages.find((p) => p.items.some((i) => i.key === "giant"));
    expect(giantPage).toBeDefined();
    // small should not be on the same page as giant
    const smallPage = pages.find((p) => p.items.some((i) => i.key === "small"));
    expect(smallPage).toBeDefined();
    expect(giantPage).not.toBe(smallPage);
  });

  it("handles empty items list", () => {
    const pages = paginate([], PAGE_HEIGHT);
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(0);
  });

  it("handles single item", () => {
    const items: PaginationItem[] = [{ key: "only", height: 500 }];
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(1);
  });

  it("creates multiple continuation pages for very long sections", () => {
    const items: PaginationItem[] = [
      { key: "exp-title", height: 40, sectionId: "experience", isSectionHeader: true },
      ...Array.from({ length: 10 }, (_, i) => ({
        key: `exp-${i}`,
        height: 300,
        sectionId: "experience",
      })),
    ];
    // title(40) + 3 items(900) = 940 ≤ 1000 → page 1
    // reserved(40) + 3 items(900) = 940 ≤ 1000 → page 2
    // reserved(40) + 3 items(900) = 940 ≤ 1000 → page 3
    // reserved(40) + 1 item(300) = 340 ≤ 1000 → page 4
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(4);
    expect(pages[1].continuedSectionId).toBe("experience");
    expect(pages[2].continuedSectionId).toBe("experience");
    expect(pages[3].continuedSectionId).toBe("experience");
  });

  it("does not orphan a section header at the bottom of a page", () => {
    const items: PaginationItem[] = [
      { key: "header", height: 100 },
      { key: "exp-title", height: 40, sectionId: "experience", isSectionHeader: true },
      { key: "exp-0", height: 300, sectionId: "experience" },
      { key: "edu-title", height: 40, sectionId: "education", isSectionHeader: true },
      { key: "edu-0", height: 200, sectionId: "education" },
    ];
    // Page height = 1000
    // header(100) + exp-title(40) + exp-0(300) = 440
    // + edu-title(40) + edu-0(200) = 680 ≤ 1000 → all fit on 1 page
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(1);
  });

  it("moves section header to next page if only header fits", () => {
    const items: PaginationItem[] = [
      { key: "big", height: 950 },
      { key: "edu-title", height: 40, sectionId: "education", isSectionHeader: true },
      { key: "edu-0", height: 200, sectionId: "education" },
    ];
    // big(950) + edu-title(40) = 990 ≤ 1000, but edu-0(200) won't fit
    // A section header alone at page bottom is an orphan → move header+item to next page
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(2);
    // edu-title should NOT be alone at the end of page 1
    const page1Keys = pages[0].items.map((i) => i.key);
    expect(page1Keys).toEqual(["big"]);
    expect(pages[1].items.map((i) => i.key)).toEqual(["edu-title", "edu-0"]);
  });

  it("different sections on different pages", () => {
    const items: PaginationItem[] = [
      { key: "a-title", height: 40, sectionId: "a", isSectionHeader: true },
      { key: "a-0", height: 450, sectionId: "a" },
      { key: "b-title", height: 40, sectionId: "b", isSectionHeader: true },
      { key: "b-0", height: 450, sectionId: "b" },
      { key: "c-title", height: 40, sectionId: "c", isSectionHeader: true },
      { key: "c-0", height: 450, sectionId: "c" },
    ];
    // a-title(40) + a-0(450) + b-title(40) + b-0(450) = 980 ≤ 1000 → page 1
    // c-title(40) + c-0(450) = 490 ≤ 1000 → page 2
    const pages = paginate(items, PAGE_HEIGHT);
    expect(pages).toHaveLength(2);
    expect(pages[0].items.map((i) => i.key)).toEqual(["a-title", "a-0", "b-title", "b-0"]);
    expect(pages[1].items.map((i) => i.key)).toEqual(["c-title", "c-0"]);
    expect(pages[1].continuedSectionId).toBeUndefined();
  });
});
