import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportButton } from "@/components/editor/export-button";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

describe("ExportButton", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    clickSpy.mockRestore();
  });

  function fakePdfResponse(): Response {
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
    } as unknown as Response;
  }

  it("defers revoking the PDF blob URL until after the download click starts", async () => {
    globalThis.fetch = vi.fn(async () => fakePdfResponse()) as unknown as typeof fetch;

    render(
      <ExportButton
        resumeId="r1"
        filename="简历"
        onExportImage={vi.fn()}
        isExportingImage={false}
        paginationData={{ pageBreaks: [], totalHeight: 1000 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出简历" }));
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下载 PDF" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(toastSuccessMock).toHaveBeenCalledWith("PDF 已生成");
  });
});
