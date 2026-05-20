import "@testing-library/jest-dom/vitest";

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

for (const proto of [Text.prototype, Range.prototype]) {
  const p = proto as unknown as {
    getClientRects?: RectsFn;
    getBoundingClientRect?: RectFn;
  };
  if (!p.getClientRects) p.getClientRects = emptyRects;
  if (!p.getBoundingClientRect) p.getBoundingClientRect = emptyRect;
}
