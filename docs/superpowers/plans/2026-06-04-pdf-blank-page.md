# PDF Blank Page Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent PDF export from adding an empty trailing page when the resume preview content still fits on one A4 page.

**Architecture:** Keep the PDF-only pagination threshold aligned with the live `PaginatedPreview`: content that is at or below `A4_HEIGHT_PX` remains a single page. Retain a trailing-page guard so tiny overflow caused by margins or measurement noise is merged back into the previous page.

**Tech Stack:** Next.js 16 App Router, React 19 Client Component, Vitest + Testing Library + jsdom.

---

### Task 1: Reproduce The Spurious PDF Page

**Files:**
- Create: `tests/unit/pdf-preview-pagination.test.tsx`
- Modify: `components/preview/pdf-preview.tsx`

- [x] **Step 1: Write the failing test**

Add a test that mocks PDF measurement at `1100px`, which is below `A4_HEIGHT_PX` (`1123px`) but above the old PDF-only safety threshold (`1083px`):

```tsx
it("keeps content below one A4 page on a single PDF page", async () => {
  setMeasuredHeight(1100);

  render(<PdfPreview content={emptyResumeContent()} resolved={{ source: "builtin", id: "professional" }} />);

  await waitFor(() => {
    expect(document.querySelector("[data-pdf-ready]")).toHaveAttribute("data-pdf-num-pages", "1");
  });
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/unit/pdf-preview-pagination.test.tsx`

Expected before the fix: FAIL because `data-pdf-num-pages` is `"2"`.

- [x] **Step 3: Implement the minimal pagination fix**

In `components/preview/pdf-preview.tsx`, make `calculatePageBreaks` return no breaks when `totalHeight <= A4_HEIGHT_PX`, and add the same near-empty trailing page merge used by the live preview:

```ts
if (totalHeight <= A4_HEIGHT_PX) return [];

if (breaks.length > 0) {
  const lastBreak = breaks[breaks.length - 1];
  const lastPageContent = totalHeight - lastBreak;
  if (lastPageContent < MIN_LAST_PAGE_CONTENT) {
    breaks.pop();
  }
}
```

- [x] **Step 4: Run the focused test to verify it passes**

Run: `pnpm vitest run tests/unit/pdf-preview-pagination.test.tsx`

Expected after the fix: PASS.

- [x] **Step 5: Run the PDF-related unit tests**

Run: `pnpm vitest run tests/unit/pdf-preview-pagination.test.tsx tests/unit/pagination.test.ts tests/unit/pdf-route-helpers.test.ts`

Expected: PASS.

### Task 2: Build-Time Email Client Guard

**Files:**
- Create: `tests/unit/email-code.test.ts`
- Modify: `lib/email-code.ts`

- [x] **Step 1: Write the failing import-safety test**

Add a test that clears `AUTH_RESEND_KEY`, imports `lib/email-code.ts`, and expects module evaluation not to throw:

```ts
it("does not require a Resend API key during module import", async () => {
  const originalKey = process.env.AUTH_RESEND_KEY;
  delete process.env.AUTH_RESEND_KEY;
  vi.resetModules();

  try {
    await expect(import("@/lib/email-code")).resolves.toHaveProperty("generateCode");
  } finally {
    if (originalKey === undefined) {
      delete process.env.AUTH_RESEND_KEY;
    } else {
      process.env.AUTH_RESEND_KEY = originalKey;
    }
    vi.resetModules();
  }
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/unit/email-code.test.ts`

Expected before the fix: FAIL with Resend missing API key during import.

- [x] **Step 3: Lazily create the Resend client**

In `lib/email-code.ts`, replace top-level `new Resend(process.env.AUTH_RESEND_KEY)` with a helper that constructs the client inside `sendVerificationCode` and throws a clear runtime error only when sending without a key.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `pnpm vitest run tests/unit/email-code.test.ts`

Expected after the fix: PASS.

### Task 3: Final Verification

**Files:**
- Verify only.

- [x] **Step 1: Run project test gate**

Run: `pnpm test`

Expected: all Vitest suites pass.

- [x] **Step 2: Run type check**

Run: `pnpm tsc --noEmit`

Expected: exit 0.

- [x] **Step 3: Run lint**

Run: `pnpm lint`

Expected: exit 0.

- [x] **Step 4: Run production build**

Run: `pnpm build`

Expected: exit 0, keeping the existing intentional build-time `DATABASE_URL` placeholder warning if it appears.
