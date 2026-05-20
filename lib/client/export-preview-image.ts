import { toPng } from "html-to-image";

type ExportPreviewImageOptions = {
  root: HTMLElement;
  filename: string;
};

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
    pixelRatio: 2,
  });

  downloadDataUrl(dataUrl, filename);
}
