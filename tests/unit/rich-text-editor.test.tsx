import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import type { TipTapJSON } from "@/lib/tiptap-types";

const paragraphDoc: TipTapJSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello" }],
    },
  ],
};

describe("RichTextEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders concrete font size buttons in the toolbar", () => {
    render(<RichTextEditor content={paragraphDoc} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "14" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "18" })).toBeInTheDocument();
  });

  it("hides the AI polish button when no polish context is supplied", () => {
    render(<RichTextEditor content={paragraphDoc} onChange={() => {}} />);

    expect(screen.queryByRole("button", { name: "AI 润色" })).not.toBeInTheDocument();
  });

  it("synchronously hands the fontSize-bearing JSON to the parent on toolbar click", () => {
    const onChange = vi.fn();
    render(<RichTextEditor content={paragraphDoc} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "12" }));

    expect(onChange).toHaveBeenCalled();
    const lastJson = JSON.stringify(onChange.mock.calls.at(-1)?.[0]);
    expect(lastJson).toContain('"fontSize":"0.92em"');
  });

  it("emits plain JSON-serializable objects to the parent (Next 16 server-action safe)", () => {
    // Regression: ProseMirror's getJSON() returns nodes whose nested `attrs`
    // are not plain Object.prototype instances. Next.js 16's React-Flight
    // server-action serialization silently strips unknown-prototype keys,
    // dropping `fontSize` before it reaches the DB. The editor must hand
    // RHF an already-deep-cloned plain object via JSON round-trip.
    const onChange = vi.fn();
    render(<RichTextEditor content={paragraphDoc} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "12" }));

    const lastValue = onChange.mock.calls.at(-1)?.[0];
    expect(lastValue).toBeDefined();
    const visit = (node: unknown) => {
      if (node === null || typeof node !== "object") return;
      const proto = Object.getPrototypeOf(node);
      expect(proto === Object.prototype || proto === Array.prototype).toBe(true);
      for (const value of Object.values(node)) visit(value);
    };
    visit(lastValue);
    const round = JSON.stringify(JSON.parse(JSON.stringify(lastValue)));
    expect(round).toContain('"fontSize":"0.92em"');
  });

  it("shows the previously saved font size on the toolbar after mount", async () => {
    render(
      <RichTextEditor
        content={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Hello",
                  marks: [
                    { type: "textStyle", attrs: { fontSize: "1.23em" } },
                  ],
                },
              ],
            },
          ],
        }}
        onChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "16" }).className,
      ).toContain("font-medium");
    });
  });

  it("requests a rich text polish candidate and only applies it after confirmation", async () => {
    const onChange = vi.fn();
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_polish_ui",
          result: {
            format: "plain_text",
            polishedText: "负责核心业务系统前端开发，持续优化页面性能与交互体验。",
            changeSummary: "按 STAR 思路强化职责与行动表达。",
            riskFlags: [
              {
                type: "too_little_context",
                message: "原文缺少可量化结果，已按现有信息保守润色。",
              },
            ],
          },
          usage: {
            provider: "fake-provider",
            model: "fake-model",
            inputTokens: 120,
            outputTokens: 36,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RichTextEditor
        content={paragraphDoc}
        onChange={onChange}
        polish={{
          resumeId: "resume_abc",
          section: "experience",
          fieldPath: "experience.0.content",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 润色" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/rich-text/polish",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const requestBody = JSON.parse(init.body as string);
    expect(requestBody).toMatchObject({
      resumeId: "resume_abc",
      section: "experience",
      fieldPath: "experience.0.content",
      locale: "zh-CN",
      content: {
        format: "tiptap_json",
        plainText: "Hello",
        tiptapJson: paragraphDoc,
      },
      intent: {
        mode: "polish",
        tone: "professional",
        length: "same",
        strategy: "star",
      },
    });

    expect(
      await screen.findByText("负责核心业务系统前端开发，持续优化页面性能与交互体验。"),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ text: "负责核心业务系统前端开发，持续优化页面性能与交互体验。" }),
            ]),
          }),
        ]),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "应用润色" }));

    await waitFor(() => {
      const lastJson = JSON.stringify(onChange.mock.calls.at(-1)?.[0]);
      expect(lastJson).toContain("负责核心业务系统前端开发");
    });
  });
});
