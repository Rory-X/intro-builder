/**
 * Pagination algorithm for multi-page resume preview.
 *
 * Given a flat list of measurable items with heights, assigns them to pages
 * using a greedy bin-packing approach. Respects section boundaries and avoids
 * orphaning section headers at the bottom of a page.
 */

/** A4 dimensions at 96 DPI (browser standard) */
export const A4_WIDTH_PX = 794; // 210mm
export const A4_HEIGHT_PX = 1123; // 297mm

export type PaginationItem = {
  /** Unique identifier for this element */
  key: string;
  /** Measured height in pixels */
  height: number;
  /** Section this item belongs to (undefined for standalone elements like the header) */
  sectionId?: string;
  /** Whether this item is a section header/title */
  isSectionHeader?: boolean;
};

export type Page = {
  /** Items assigned to this page */
  items: PaginationItem[];
  /** If this page continues a section from the previous page, the section's ID */
  continuedSectionId?: string;
};

/**
 * Assign items to pages using a greedy algorithm.
 *
 * Rules:
 * 1. Items are placed on the current page until the next item would overflow.
 * 2. When a section is split across pages, subsequent pages reserve space for
 *    the repeated section header (determined from the original header height).
 * 3. A section header is never left alone at the bottom of a page (orphan
 *    prevention): if only the header fits but no items after it, move the
 *    header to the next page.
 * 4. If a single item is taller than the page, it gets its own page (overflow
 *    allowed — this is an edge case for extremely long content).
 */
export function paginate(
  items: PaginationItem[],
  pageHeight: number,
): Page[] {
  if (items.length === 0) {
    return [{ items: [] }];
  }

  const pages: Page[] = [];
  let currentPage: PaginationItem[] = [];
  let currentHeight = 0;
  let lastSectionHeaderHeight = 0;

  function finalizePage() {
    pages.push({
      items: currentPage,
      continuedSectionId: pages.length > 0 ? getContinuedSection() : undefined,
    });
    currentPage = [];
    currentHeight = 0;
  }

  function getContinuedSection(): string | undefined {
    // Check if the previous page ended mid-section
    if (pages.length === 0) return undefined;
    const prevPage = pages[pages.length - 1];
    if (prevPage.items.length === 0) return undefined;
    const lastItem = prevPage.items[prevPage.items.length - 1];
    return lastItem.sectionId;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Track section context
    if (item.isSectionHeader && item.sectionId) {
      lastSectionHeaderHeight = item.height;
    }

    // Check if item fits on current page
    const wouldOverflow = currentHeight + item.height > pageHeight && currentPage.length > 0;

    if (wouldOverflow) {
      // Check for orphan prevention: if the last item on the current page
      // is a section header with no items after it, move it to the next page
      const lastOnPage = currentPage[currentPage.length - 1];
      if (lastOnPage?.isSectionHeader && lastOnPage.sectionId === item.sectionId) {
        // Remove the orphaned header from current page
        currentPage.pop();
        currentHeight -= lastOnPage.height;
        finalizePage();
        // Add the header to the new page
        currentPage.push(lastOnPage);
        currentHeight = lastOnPage.height;
      } else {
        finalizePage();
      }

      // If this is continuing a section, account for reserved header space
      if (item.sectionId && !item.isSectionHeader) {
        const prevPageItems = pages[pages.length - 1]?.items ?? [];
        const prevLast = prevPageItems[prevPageItems.length - 1];
        if (prevLast?.sectionId === item.sectionId) {
          currentHeight = lastSectionHeaderHeight;
        }
      }
    }

    // Place the item
    currentPage.push(item);
    currentHeight += item.height;

    // Special case: if this single item exceeds page height (oversized),
    // finalize it immediately so it gets its own page
    if (item.height > pageHeight && currentPage.length === 1) {
      finalizePage();
    }
  }

  // Finalize the last page
  if (currentPage.length > 0) {
    // Determine if the last page continues a section
    let continued: string | undefined;
    if (pages.length > 0) {
      const prevPage = pages[pages.length - 1];
      const prevLast = prevPage.items[prevPage.items.length - 1];
      const firstOnCurrent = currentPage[0];
      if (
        prevLast?.sectionId &&
        firstOnCurrent?.sectionId === prevLast.sectionId &&
        !firstOnCurrent.isSectionHeader
      ) {
        continued = prevLast.sectionId;
      }
    }
    pages.push({ items: currentPage, continuedSectionId: continued });
  }

  return pages;
}
