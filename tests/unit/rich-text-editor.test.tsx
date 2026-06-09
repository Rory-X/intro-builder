import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("renders concrete font size buttons in the toolbar", () => {
    render(<RichTextEditor content={paragraphDoc} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "14" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "18" })).toBeInTheDocument();
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
      ).toContain("font-bold");
      expect(
        screen.getByRole("button", { name: "16" }).className,
      ).toContain("text-blue-700");
    });
  });

  it("uses a blue active state for selected toolbar icons", async () => {
    render(<RichTextEditor content={paragraphDoc} onChange={() => {}} />);

    fireEvent.click(screen.getByTitle("粗体"));

    await waitFor(() => {
      expect(screen.getByTitle("粗体").className).toContain("text-blue-700");
    });
  });
});
