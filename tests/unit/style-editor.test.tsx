import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { StyleEditor } from "@/components/editor/style-editor";
import { emptyResumeContent, type ResumeContent } from "@/lib/resume-schema";
import { TEMPLATES, type AllTemplatesItem } from "@/lib/templates/registry";

// Built-in projection. The picker iterates over this merged shape so the
// gallery surfaces both built-in and uploaded templates from a single
// server-resolved list. Reused as the default fixture for tests that don't
// care about template-list specifics (font/line-height/padding behavior).
const builtinList: AllTemplatesItem[] = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  thumbnailUrl: null,
  source: "builtin",
  isRecommended: t.isRecommended,
}));

function Harness({
  onReady,
  allTemplates = builtinList,
  onTemplateChange,
}: {
  onReady?: (form: UseFormReturn<ResumeContent>) => void;
  allTemplates?: AllTemplatesItem[];
  onTemplateChange?: (id: string) => void;
}) {
  const content = emptyResumeContent();
  content.styleSettings = {
    fontFamily: "sans",
    fontSize: 15,
    lineHeight: 1.6,
    pagePadding: 40,
  };
  const form = useForm<ResumeContent>({ defaultValues: content });
  onReady?.(form);

  return (
    <FormProvider {...form}>
      <StyleEditor
        templateId="professional"
        onTemplateChange={onTemplateChange ?? vi.fn()}
        allTemplates={allTemplates}
      />
    </FormProvider>
  );
}

describe("StyleEditor", () => {
  it("line-height dropdown does not overwrite the current font size", () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: /模板与排版/ }));
    fireEvent.click(screen.getByRole("button", { name: "行距：1.6" }));
    fireEvent.click(screen.getByRole("button", { name: "行距：1.8" }));

    expect(form.getValues("styleSettings")?.fontSize).toBe(15);
    expect(form.getValues("styleSettings")?.lineHeight).toBe(1.8);
  });

  it("uses dropdown value pickers for font size and page padding", () => {
    let form!: UseFormReturn<ResumeContent>;
    render(<Harness onReady={(readyForm) => { form = readyForm; }} />);

    fireEvent.click(screen.getByRole("button", { name: /模板与排版/ }));

    fireEvent.click(screen.getByRole("button", { name: "字号：15px" }));
    fireEvent.click(screen.getByRole("button", { name: "字号：12px" }));
    expect(form.getValues("styleSettings")?.fontSize).toBe(12);

    fireEvent.click(screen.getByRole("button", { name: "页边距：40px" }));
    fireEvent.click(screen.getByRole("button", { name: "页边距：55px" }));
    expect(form.getValues("styleSettings")?.pagePadding).toBe(55);
  });

  describe("template gallery", () => {
    it("renders every built-in template card", () => {
      render(<Harness allTemplates={builtinList} />);
      fireEvent.click(screen.getByRole("button", { name: /模板与排版/ }));

      // Three built-ins shipped at v0.3 — guard against accidentally dropping
      // one. Match by exact name (the picker shows `t.name` as the card
      // header) so the assertion isn't fooled by neighboring text.
      for (const t of builtinList) {
        expect(screen.getByText(t.name)).toBeInTheDocument();
      }
    });

    it("renders uploaded template cards alongside built-ins", () => {
      const merged: AllTemplatesItem[] = [
        ...builtinList,
        {
          id: "uploaded-1",
          name: "我的自定义模板",
          description: "Custom uploaded template",
          thumbnailUrl: null,
          source: "uploaded",
        },
      ];
      render(<Harness allTemplates={merged} />);
      fireEvent.click(screen.getByRole("button", { name: /模板与排版/ }));

      // Without thumbnailUrl, the placeholder block must render — confirming
      // the foundation-phase abbey-stub case is handled. The placeholder
      // block AND the card header both show the name, so we key the
      // assertion on the testid we attached to the thumbnail wrapper for a
      // stable, single-match selector.
      const thumb = screen.getByTestId("template-thumb-uploaded-1");
      expect(thumb).toBeInTheDocument();
      expect(thumb.textContent).toContain("我的自定义模板");
    });

    it("renders an <img> when an uploaded template has a thumbnailUrl", () => {
      const merged: AllTemplatesItem[] = [
        ...builtinList,
        {
          id: "uploaded-2",
          name: "带封面",
          description: "Has thumbnail",
          thumbnailUrl: "https://example.com/thumb.png",
          source: "uploaded",
        },
      ];
      render(<Harness allTemplates={merged} />);
      fireEvent.click(screen.getByRole("button", { name: /模板与排版/ }));

      const thumb = screen.getByTestId("template-thumb-uploaded-2");
      const img = thumb.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe("https://example.com/thumb.png");
    });

    it("calls onTemplateChange with the uploaded id when its card is clicked", () => {
      const onTemplateChange = vi.fn();
      const merged: AllTemplatesItem[] = [
        ...builtinList,
        {
          id: "uploaded-3",
          name: "另一个上传模板",
          description: "",
          thumbnailUrl: null,
          source: "uploaded",
        },
      ];
      render(
        <Harness allTemplates={merged} onTemplateChange={onTemplateChange} />,
      );
      fireEvent.click(screen.getByRole("button", { name: /模板与排版/ }));

      // The card itself is the closest button to the thumbnail block we
      // tagged with a stable testid. Walk up to the button and click it.
      const thumb = screen.getByTestId("template-thumb-uploaded-3");
      const card = thumb.closest("button");
      expect(card).not.toBeNull();
      fireEvent.click(card as HTMLButtonElement);
      expect(onTemplateChange).toHaveBeenCalledWith("uploaded-3");
    });

    it("renders nothing when given an empty list", () => {
      // Defensive: a future caller might pass `[]` if both lists fail to
      // load. The picker should still render the popover shell without
      // throwing.
      expect(() => render(<Harness allTemplates={[]} />)).not.toThrow();
      expect(
        screen.getByRole("button", { name: /模板与排版/ }),
      ).toBeInTheDocument();
    });
  });
});
