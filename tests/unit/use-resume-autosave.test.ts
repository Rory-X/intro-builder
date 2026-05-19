import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useResumeAutosave } from "@/hooks/use-resume-autosave";
import type { ResumeContent } from "@/lib/resume-schema";
import { emptyResumeContent } from "@/lib/resume-schema";

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
});
