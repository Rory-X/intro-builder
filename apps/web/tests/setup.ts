import "@testing-library/jest-dom/vitest";

// Suppress unhandled rejections from ag-ui HttpAgent in tests that mock 503 errors.
// The HttpAgent throws errors asynchronously for failed requests, which is expected
// behavior in tests that verify error handling. In production, these are caught by
// the useAgUiRuntime onError callback.
process.on("unhandledRejection", (reason) => {
  const isAgUiHttpError =
    reason &&
    typeof reason === "object" &&
    "status" in reason &&
    reason.status === 503;
  if (!isAgUiHttpError) {
    // Re-throw non-ag-ui errors so they still fail tests
    throw reason;
  }
  // Silently ignore ag-ui 503 errors in tests
});

// jsdom lacks `getClientRects` / `getBoundingClientRect` on text nodes and
// ranges. ProseMirror touches them whenever a transaction scrolls the
// selection into view (e.g. after `chain().focus().run()`), so without
// these no-op polyfills any TipTap test that mutates the selection blows
// up with `target.getClientRects is not a function`.
type RectFn = () => DOMRect;
type RectsFn = () => DOMRectList;
const emptyRect: RectFn = () =>
  ({
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
const emptyRects: RectsFn = () => [] as unknown as DOMRectList;

const geometryTargets = [
  typeof Text === "undefined" ? null : Text.prototype,
  typeof Range === "undefined" ? null : Range.prototype,
].filter(Boolean);

for (const proto of geometryTargets) {
  const p = proto as unknown as {
    getClientRects?: RectsFn;
    getBoundingClientRect?: RectFn;
  };
  if (!p.getClientRects) p.getClientRects = emptyRects;
  if (!p.getBoundingClientRect) p.getBoundingClientRect = emptyRect;
}
