import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toPng } from "html-to-image";
import { exportPreviewImage, sanitizeImageFilename } from "@/lib/client/export-preview-image";

vi.mock("html-to-image", () => ({
  toPng: vi.fn().mockResolvedValue("data:image/png;base64,preview"),
}));

const toPngMock = vi.mocked(toPng);

describe("exportPreviewImage", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    toPngMock.mockClear();
    toPngMock.mockResolvedValue("data:image/png;base64,preview");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures the resume article inside the preview root", async () => {
    const root = document.createElement("div");
    const wrapper = document.createElement("div");
    const article = document.createElement("article");
    wrapper.append(article);
    root.append(wrapper);
    document.body.append(root);

    await exportPreviewImage({ root, filename: "我的简历" });

    expect(toPngMock).toHaveBeenCalledWith(
      article,
      expect.objectContaining({
        backgroundColor: "#ffffff",
        cacheBust: true,
        imagePlaceholder: expect.stringMatching(/^data:image\/png;base64,/),
        onImageErrorHandler: expect.any(Function),
        pixelRatio: 2,
      }),
    );
  });

  it("rejects when the preview root does not contain a resume article", async () => {
    const root = document.createElement("div");

    await expect(exportPreviewImage({ root, filename: "简历" })).rejects.toThrow(
      "未找到可导出的简历内容",
    );
    expect(toPngMock).not.toHaveBeenCalled();
  });

  it("sanitizes filenames and appends png extension", () => {
    expect(sanitizeImageFilename(" 实习生/钱嘉豪 ")).toBe("实习生-钱嘉豪.png");
    expect(sanitizeImageFilename("")).toBe("resume.png");
    expect(sanitizeImageFilename("resume.png")).toBe("resume.png");
  });
});
