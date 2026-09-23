import "@testing-library/jest-dom/vitest";

// Node 26+ ships an experimental global `localStorage` / `sessionStorage`
// accessor that resolves to `undefined` unless the process was started with
// `--localstorage-file`. Because the global already exists, it shadows the
// jsdom-provided Storage, so `window.localStorage` is `undefined` and every
// component that touches it (e.g. components/agent/agent-panel.tsx) throws
// "Cannot read properties of undefined". CI runs Node 22 (no such global), so
// this only surfaced on newer local runtimes while looking like a real test
// regression. Install an in-memory Storage whenever the ambient one is absent
// or unusable, so the suite behaves identically across Node versions.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) {
      return store.has(String(key)) ? (store.get(String(key)) as string) : null;
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  } as Storage;
}

function usableStorage(key: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const candidate = (globalThis as unknown as Record<string, unknown>)[key];
    if (
      candidate &&
      typeof (candidate as Storage).getItem === "function" &&
      typeof (candidate as Storage).setItem === "function"
    ) {
      return candidate as Storage;
    }
  } catch {
    // Accessor threw (some runtimes do without the backing file).
  }
  return null;
}

for (const key of ["localStorage", "sessionStorage"] as const) {
  if (!usableStorage(key)) {
    Object.defineProperty(globalThis, key, {
      value: createMemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
}

// jsdom installs its own `File` / `Blob` / `FormData`, but Node's fetch layer
// (undici) brand-checks multipart entries against *Node's own* `File` when
// parsing `request.formData()`. On Node 26 that check rejects jsdom's File with
// an opaque
//   assert(typeof value === "string" && webidl.is.USVString(value) ||
//          webidl.is.File(value))
// which surfaces as a bogus 500 in route tests (app/api/upload-photo/route.ts).
// Node 22's undici accepts jsdom's File, so CI never caught this and the failure
// only appeared on newer local runtimes — looking exactly like a product
// regression.
//
// Only `File` needs replacing, but it must be replaced *together with* the
// FormData that understands it: jsdom's FormData stringifies a foreign File on
// `set()`, silently losing name/type/size. Recover undici's FormData from a
// parsed multipart request (that is the constructor `Request.prototype.formData`
// returns), then install the matching pair so the same code path works on every
// Node version.
async function alignFormDataWithNodeFile(): Promise<void> {
  const boundary = "----intro-builder-setup-probe";
  const probe = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="probe"',
    "",
    "1",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  let undiciFormData: (new () => FormData) | undefined;
  try {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: probe,
    });
    const parsed = await request.formData();
    undiciFormData = parsed.constructor as new () => FormData;
  } catch {
    undiciFormData = undefined;
  }
  if (!undiciFormData || undiciFormData === undefined) return;

  // Confirm the swap is actually needed: if jsdom's trio already round-trips,
  // leave the environment untouched.
  try {
    const file = new File(["x"], "probe.png", { type: "image/png" });
    const form = new FormData();
    form.set("file", file);
    const request = new Request("http://localhost/", { method: "PUT", body: form });
    const roundTripped = (await request.formData()).get("file") as File | null;
    if (roundTripped && roundTripped.type === "image/png" && roundTripped.size === 1) {
      return;
    }
  } catch {
    // Fall through and install the Node-native pair.
  }

  const { File: NodeFile } = await import("node:buffer");
  Object.defineProperty(globalThis, "File", {
    value: NodeFile,
    writable: true,
    configurable: true,
  });

  // undici's FormData rejects `new FormData(formElement)` — its brand check does
  // not recognise jsdom's HTMLFormElement — so keep jsdom's implementation for
  // that call site (login flows build one from a <form>) and delegate every
  // other construction to the undici one that survives a Request round-trip.
  const jsdomFormData = globalThis.FormData;
  const formDataCompat = function FormDataCompat(
    this: unknown,
    form?: unknown,
  ): FormData {
    if (form !== undefined && form !== null) {
      return new jsdomFormData(form as HTMLFormElement);
    }
    return new undiciFormData!();
  } as unknown as typeof FormData;
  formDataCompat.prototype = undiciFormData.prototype;
  Object.defineProperty(globalThis, "FormData", {
    value: formDataCompat,
    writable: true,
    configurable: true,
  });
}

await alignFormDataWithNodeFile();

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
