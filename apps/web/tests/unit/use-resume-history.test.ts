import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";

import {
  useResumeHistory,
  type ResumeEditorSnapshot,
} from "@/hooks/use-resume-history";

function snapshot(name: string): ResumeEditorSnapshot {
  const content = emptyResumeContent();
  content.basics.name = name;
  return {
    title: `简历-${name}`,
    templateId: "professional",
    content,
  };
}

describe("useResumeHistory", () => {
  it("undoes and redoes editor snapshots", () => {
    const { result } = renderHook(() => useResumeHistory(snapshot("一")));

    act(() => result.current.capture(snapshot("二"), { merge: false }));
    act(() => result.current.capture(snapshot("三"), { merge: false }));

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      expect(result.current.undo()?.content.basics.name).toBe("二");
    });
    expect(result.current.current.content.basics.name).toBe("二");
    expect(result.current.canRedo).toBe(true);

    act(() => {
      expect(result.current.redo()?.content.basics.name).toBe("三");
    });
    expect(result.current.current.content.basics.name).toBe("三");
  });

  it("clears the redo branch after a new capture", () => {
    const { result } = renderHook(() => useResumeHistory(snapshot("一")));

    act(() => result.current.capture(snapshot("二"), { merge: false }));
    act(() => void result.current.undo());
    act(() => result.current.capture(snapshot("新分支"), { merge: false }));

    expect(result.current.canRedo).toBe(false);
    expect(result.current.current.content.basics.name).toBe("新分支");
  });

  it("ignores duplicate snapshots so programmatic resets do not add undo steps", () => {
    const { result } = renderHook(() => useResumeHistory(snapshot("一")));

    act(() => result.current.capture(snapshot("二"), { merge: false }));
    act(() => result.current.capture(snapshot("二"), { merge: true }));

    act(() => {
      expect(result.current.undo()?.content.basics.name).toBe("一");
    });
    expect(result.current.canUndo).toBe(false);
  });

  it("merges rapid typing snapshots into one undo step", () => {
    const { result } = renderHook(() => useResumeHistory(snapshot("一")));

    act(() => result.current.capture(snapshot("二"), { merge: true }));
    act(() => result.current.capture(snapshot("三"), { merge: true }));

    act(() => {
      expect(result.current.undo()?.content.basics.name).toBe("一");
    });
    expect(result.current.current.content.basics.name).toBe("一");
  });

  it("starts a new undo step when typing resumes after the merge window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
      const { result } = renderHook(() => useResumeHistory(snapshot("一")));

      act(() => result.current.capture(snapshot("二"), { merge: true }));
      vi.advanceTimersByTime(2_100);
      act(() => result.current.capture(snapshot("三"), { merge: true }));

      act(() => {
        expect(result.current.undo()?.content.basics.name).toBe("二");
      });
      expect(result.current.current.content.basics.name).toBe("二");
      act(() => {
        expect(result.current.undo()?.content.basics.name).toBe("一");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most fifty undo entries", () => {
    const { result } = renderHook(() => useResumeHistory(snapshot("0")));

    for (let i = 1; i <= 60; i += 1) {
      act(() => result.current.capture(snapshot(String(i)), { merge: false }));
    }

    let steps = 0;
    while (result.current.canUndo) {
      act(() => void result.current.undo());
      steps += 1;
    }
    expect(steps).toBe(50);
    expect(result.current.current.content.basics.name).toBe("10");
  });
});
