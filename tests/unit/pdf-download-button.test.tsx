import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfDownloadButton } from "@/app/(app)/resume/[id]/edit/pdf-download-button";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

describe("PdfDownloadButton", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  function fakePdfResponse(): Response {
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
    } as unknown as Response;
  }

  it("shows a loading state while the PDF is being generated and triggers a download", async () => {
    let resolveFetch!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;

    render(<PdfDownloadButton resumeId="r1" filename="实习生-钱嘉豪" />);

    const button = screen.getByRole("button", { name: "下载 PDF" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成 PDF 中…" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "生成 PDF 中…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await act(async () => {
      resolveFetch(fakePdfResponse());
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "下载 PDF" })).toBeEnabled();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("PDF 已生成");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("surfaces an error toast and re-enables the button on failure", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      blob: async () => new Blob([]),
    } as unknown as Response)) as unknown as typeof fetch;

    render(<PdfDownloadButton resumeId="r1" filename="简历" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下载 PDF" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "下载 PDF" })).toBeEnabled();
    });
    expect(toastErrorMock).toHaveBeenCalledWith("PDF 生成失败，请稍后重试");
  });

  it("ignores extra clicks while a download is already in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    render(<PdfDownloadButton resumeId="r1" filename="简历" />);

    const button = screen.getByRole("button", { name: "下载 PDF" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(fakePdfResponse());
    });
  });
});
