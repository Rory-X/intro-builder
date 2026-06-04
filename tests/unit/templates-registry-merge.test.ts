import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/templates/uploaded/fetch", () => ({
  fetchUploadedTemplate: vi.fn(),
  fetchDefaultUploadedTemplate: vi.fn(),
  listUploadedTemplates: vi.fn(),
}));

import {
  fetchDefaultUploadedTemplate,
  fetchUploadedTemplate,
  listUploadedTemplates,
} from "@/lib/templates/uploaded/fetch";
import {
  getTemplateMetaAsync,
  listAllTemplatesAsync,
} from "@/lib/templates/registry-server";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

const DEFAULT_TEMPLATE_ROW_ID = "professional";

const mockTemplate: UploadedTemplate = {
  id: "abbey-elegant",
  name: "陈媛媛优雅风",
  description: null,
  thumbnailUrl: null,
  sectionIcons: {},
  html: null,
  css: null,
  category: null,
  features: null,
};

const defaultTemplate: UploadedTemplate = {
  id: DEFAULT_TEMPLATE_ROW_ID,
  name: "专业",
  description: "默认模板",
  thumbnailUrl: null,
  sectionIcons: {},
  html: "<main></main>",
  css: ".resume{}",
  category: "tech",
  features: null,
};

describe("getTemplateMetaAsync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries DB by id and returns the matching template", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(mockTemplate);
    const resolved = await getTemplateMetaAsync("abbey-elegant");
    expect(resolved.source).toBe("uploaded");
    expect(resolved.id).toBe("abbey-elegant");
    expect(fetchUploadedTemplate).toHaveBeenCalledWith("abbey-elegant");
    if (resolved.source === "uploaded") {
      expect(resolved.template).toEqual(mockTemplate);
    }
  });

  it("falls back to the DB default template for unknown id", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(null);
    vi.mocked(fetchDefaultUploadedTemplate).mockResolvedValue(defaultTemplate);
    const resolved = await getTemplateMetaAsync("does-not-exist");
    expect(resolved.source).toBe("uploaded");
    expect(resolved.id).toBe(DEFAULT_TEMPLATE_ROW_ID);
    if (resolved.source === "uploaded") {
      expect(resolved.template.html).toContain("<");
    }
  });

  it("falls back to default for null/undefined/empty without querying by id", async () => {
    vi.mocked(fetchDefaultUploadedTemplate).mockResolvedValue(defaultTemplate);
    for (const v of [null, undefined, ""] as const) {
      const resolved = await getTemplateMetaAsync(v);
      expect(resolved.source).toBe("uploaded");
      expect(resolved.id).toBe(DEFAULT_TEMPLATE_ROW_ID);
    }
    expect(fetchUploadedTemplate).not.toHaveBeenCalled();
    expect(fetchDefaultUploadedTemplate).toHaveBeenCalledTimes(3);
  });

  it("throws when no DB default template exists", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(null);
    vi.mocked(fetchDefaultUploadedTemplate).mockResolvedValue(null);
    await expect(getTemplateMetaAsync("does-not-exist")).rejects.toThrow(
      "No published template row has isDefault=true",
    );
  });
});

describe("listAllTemplatesAsync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns published DB templates only", async () => {
    vi.mocked(listUploadedTemplates).mockResolvedValue([mockTemplate]);
    const all = await listAllTemplatesAsync();
    expect(all).toHaveLength(1);
    expect(all.filter((t) => t.source === "uploaded")).toHaveLength(1);
  });

  it("returns an empty list when DB has no published templates", async () => {
    vi.mocked(listUploadedTemplates).mockResolvedValue([]);
    const all = await listAllTemplatesAsync();
    expect(all).toHaveLength(0);
  });
});
