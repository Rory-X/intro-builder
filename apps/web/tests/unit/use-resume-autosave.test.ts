import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useResumeAutosave } from "@/hooks/use-resume-autosave";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { emptyResumeContent } from "@intro-builder/shared/schemas";

function useTestAutosave(onSave: (c: ResumeContent, t: string) => Promise<void>) {
  const form = useForm<ResumeContent>({ defaultValues: emptyResumeContent() });
  useResumeAutosave({
    form,
    resumeId: "r1",
    title: "My resume",
    debounceMs: 50,
    onSave,
    onError: vi.fn(),
  });
  return form;
}

function useTestAutosaveWithUnstableAdapter(
  onSave: (c: ResumeContent, t: string) => Promise<void>,
) {
  const form = useForm<ResumeContent>({ defaultValues: emptyResumeContent() });
  useResumeAutosave({
    form: {
      watch: (cb) => form.watch((data) => cb(data as ResumeContent)),
      getValues: () => form.getValues(),
    },
    resumeId: "r1",
    title: "My resume",
    debounceMs: 50,
    onSave,
    onError: vi.fn(),
  });
  return form;
}

describe("useResumeAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces saves and persists latest form values", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTestAutosave(onSave));

    await act(async () => {
      result.current.setValue("basics.summary", "first", { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(30);
      result.current.setValue("basics.summary", "second", { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].basics.summary).toBe("second");
  });

  it("queues a follow-up save when edits happen during an in-flight save", async () => {
    let resolveFirst: () => void = () => {};
    const first = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useTestAutosave(onSave));

    await act(async () => {
      result.current.setValue("basics.name", "A", { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.setValue("basics.name", "B", { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(50);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0].basics.name).toBe("B");
  });

  it("does not autosave on mount or rerender without edits", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(() => useTestAutosaveWithUnstableAdapter(onSave));

    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(100);
      await vi.runAllTimersAsync();
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("persists rich text font size changes in nested project content", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTestAutosave(onSave));

    await act(async () => {
      result.current.setValue("projects", [{
        name: "P",
        role: "",
        location: "",
        start: "",
        end: "",
        stack: [],
        link: "",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Hello",
                  marks: [{ type: "textStyle", attrs: { fontSize: "12px" } }],
                },
              ],
            },
          ],
        },
      }], { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(50);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onSave.mock.calls[0][0].projects[0].content)).toContain(
      '"fontSize":"12px"',
    );
  });

  it("persists rich text font size changes when only the nested content path changes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTestAutosave(onSave));

    await act(async () => {
      result.current.setValue("projects", [{
        name: "P",
        role: "",
        location: "",
        start: "",
        end: "",
        stack: [],
        link: "",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
      }], { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(50);
      await vi.runAllTimersAsync();
    });
    onSave.mockClear();

    await act(async () => {
      result.current.setValue("projects.0.content", {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Hello",
                marks: [{ type: "textStyle", attrs: { fontSize: "12px" } }],
              },
            ],
          },
        ],
      }, { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(50);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onSave.mock.calls[0][0].projects[0].content)).toContain(
      '"fontSize":"12px"',
    );
  });

  it("flushes pending debounced changes on unmount", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useTestAutosave(onSave));

    await act(async () => {
      result.current.setValue("basics.name", "Before refresh", { shouldDirty: true });
      await vi.advanceTimersByTimeAsync(25);
      unmount();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].basics.name).toBe("Before refresh");
  });

  it("flushes pending changes when rich text toolbar requests an immediate save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTestAutosave(onSave));

    await act(async () => {
      result.current.setValue("basics.name", "Format changed", { shouldDirty: true });
      window.dispatchEvent(new Event("resume:flush-autosave"));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].basics.name).toBe("Format changed");
  });
});
