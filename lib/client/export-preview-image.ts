import { toPng } from "html-to-image";

type ExportPreviewImageOptions = {
  root: HTMLElement;
  filename: string;
};

const TRANSPARENT_IMAGE_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

export function sanitizeImageFilename(filename: string): string {
  const sanitized = filename
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!sanitized) return "resume.png";
  return sanitized.toLowerCase().endsWith(".png") ? sanitized : `${sanitized}.png`;
}

async function waitForFonts() {
  if ("fonts" in document) {
    await document.fonts.ready;
  }
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.download = sanitizeImageFilename(filename);
  link.href = dataUrl;
  link.click();
}

export async function exportPreviewImage({ root, filename }: ExportPreviewImageOptions) {
  const article = root.querySelector("article");
  if (!(article instanceof HTMLElement)) {
    throw new Error("未找到可导出的简历内容");
  }

  await waitForFonts();

  const dataUrl = await toPng(article, {
    backgroundColor: "#ffffff",
    cacheBust: true,
    imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
    onImageErrorHandler: () => undefined,
    pixelRatio: 2,
  });

  downloadDataUrl(dataUrl, filename);
}
