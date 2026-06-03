import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/templates/uploaded/fetch", () => ({
  fetchUploadedTemplate: vi.fn(),
  listUploadedTemplates: vi.fn(),
}));

import { fetchUploadedTemplate, listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import {
  getTemplateMetaAsync,
  listAllTemplatesAsync,
} from "@/lib/templates/registry-server";
import {
  BUILTIN_TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/templates/registry";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

const mockTemplate: UploadedTemplate = {
  id: "abbey-elegant",
  name: "陈媛媛优雅风",
  description: null,
  thumbnailUrl: null,
  decoration: null,
  layout: {
    frame: { kind: "vertical" },
    headerVariant: "professional",
    sectionTitleVariant: "professional",
    itemHeaderVariant: "professional",
    theme: { primaryColor: "#137880" },
    sectionIcons: {},
  },
  customHtml: null,
  customCss: null,
  category: null,
  features: null,
};

describe("getTemplateMetaAsync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes unified builtins through local HTML fallback when DB misses", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(null);
    for (const id of BUILTIN_TEMPLATE_IDS) {
      const resolved = await getTemplateMetaAsync(id);
      expect(resolved.id).toBe(id);
      // All three builtins now have local HTML+CSS → resolved as "uploaded"
      expect(resolved.source).toBe("uploaded");
      if (resolved.source === "uploaded") {
        expect(resolved.template.customHtml).toContain("<");
        expect(resolved.template.customCss).toContain("{");
      }
    }
    expect(fetchUploadedTemplate).not.toHaveBeenCalled();
  });

  it("queries DB for unknown id and returns uploaded template", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(mockTemplate);
    const resolved = await getTemplateMetaAsync("abbey-elegant");
    expect(resolved.source).toBe("uploaded");
    expect(resolved.id).toBe("abbey-elegant");
    if (resolved.source === "uploaded") {
      expect(resolved.template).toEqual(mockTemplate);
    }
  });

  it("falls back to default built-in for unknown id with no DB hit", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(null);
    const resolved = await getTemplateMetaAsync("does-not-exist");
    expect(resolved.source).toBe("builtin");
    expect(resolved.id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("falls back to default for null/undefined/empty without hitting DB", async () => {
    for (const v of [null, undefined, ""] as const) {
      const resolved = await getTemplateMetaAsync(v);
      expect(resolved.source).toBe("builtin");
      expect(resolved.id).toBe(DEFAULT_TEMPLATE_ID);
    }
    expect(fetchUploadedTemplate).not.toHaveBeenCalled();
  });
});

describe("listAllTemplatesAsync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges built-in (3) + DB results", async () => {
    vi.mocked(listUploadedTemplates).mockResolvedValue([mockTemplate]);
    const all = await listAllTemplatesAsync();
    expect(all).toHaveLength(4);
    expect(all.filter((t) => t.source === "builtin")).toHaveLength(3);
    expect(all.filter((t) => t.source === "uploaded")).toHaveLength(1);
  });

  it("returns only built-in when DB is empty", async () => {
    vi.mocked(listUploadedTemplates).mockResolvedValue([]);
    const all = await listAllTemplatesAsync();
    expect(all).toHaveLength(3);
    expect(all.every((t) => t.source === "builtin")).toBe(true);
  });
});
