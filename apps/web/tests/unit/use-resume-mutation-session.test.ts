import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { emptyResumeContent, ResumeContent as ResumeContentSchema } from "@intro-builder/shared/schemas";

import {
  useResumeMutationSession,
  MutationConflictError,
  type CommitSubmission,
  type SubmitResult,
} from "@/hooks/use-resume-mutation-session";

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function initialContent(): ResumeContent {
  return ResumeContentSchema.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
    ],
    sectionOrder: ["basics", "experience"],
  });
}

type Recorder = {
  submissions: CommitSubmission[];
  submit: (s: CommitSubmission) => Promise<SubmitResult>;
};

/** 提交记录器：默认成功，可被单个用例覆写行为。 */
function makeSubmitter(
  behavior?: (s: CommitSubmission, call: number) => Promise<SubmitResult>,
): Recorder {
  const submissions: CommitSubmission[] = [];
  return {
    submissions,
    submit: async (s) => {
      submissions.push(s);
      if (behavior) return behavior(s, submissions.length);
      return { status: "committed", revision: s.expectedRevision + 1 };
    },
  };
}

let opSeq = 0;
let mutSeq = 0;

function useSession(
  submit: (s: CommitSubmission) => Promise<SubmitResult>,
  options: { debounceMs?: number } = {},
) {
  const form = useForm<ResumeContent>({ defaultValues: initialContent() });
  const session = useResumeMutationSession({
    initial: { content: initialContent(), revision: 0, title: "我的简历", templateId: "classic" },
    getContent: () => form.getValues() as ResumeContent,
    getRow: () => ({ title: "我的简历", templateId: "classic" }),
    submit,
    debounceMs: options.debounceMs ?? 50,
    newMutationId: () => `mut_${(mutSeq += 1)}`,
    newOpId: () => `op_${(opSeq += 1)}`,
  });
  return { form, session };
}

describe("useResumeMutationSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    opSeq = 0;
    mutSeq = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("没有改动时不提交（不生成空修订）", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    await act(async () => {
      await result.current.session.flush();
    });
    expect(rec.submissions).toHaveLength(0);
  });

  it("改动后提交带 expectedRevision 与语义命令", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "李四");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(rec.submissions).toHaveLength(1);
    const submission = rec.submissions[0];
    expect(submission.expectedRevision).toBe(0);
    expect(submission.operations.length).toBeGreaterThan(0);
    expect(submission.mutationId).toMatch(/^mut_/);
  });

  it("成功后推进 revision 且**不清空表单**（用户输入不是回执的附属品）", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "李四");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.session.revision).toBe(1);
    // 表单里用户写的值必须还在。
    expect(result.current.form.getValues("basics.name")).toBe("李四");
  });

  it("回执到达前用户继续输入：新字符保留，并立刻再提交一次", async () => {
    let resolveFirst: ((r: SubmitResult) => void) | null = null;
    const rec = makeSubmitter((s, call) => {
      if (call === 1) {
        return new Promise<SubmitResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ status: "committed", revision: s.expectedRevision + 1 });
    });
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "第一次");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(rec.submissions).toHaveLength(1);

    // 在途期间继续输入。
    act(() => {
      result.current.form.setValue("basics.name", "第一次之后又改了");
      result.current.session.schedule();
    });

    // 回执到达。
    await act(async () => {
      resolveFirst?.({ status: "committed", revision: 1 });
      await vi.advanceTimersByTimeAsync(120);
    });

    // 关键：用户的后续输入没有被回执擦掉。
    expect(result.current.form.getValues("basics.name")).toBe("第一次之后又改了");
    // 并且确实又提交了一次（把后续输入存下去）。
    expect(rec.submissions.length).toBeGreaterThanOrEqual(2);
  });

  it("回执带旧 generation 时只确认旧内容，不擦除后来的标题/模板选择", async () => {
    let resolveFirst: ((r: SubmitResult) => void) | null = null;
    const rec = makeSubmitter((s, call) => {
      if (call === 1) {
        return new Promise<SubmitResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ status: "committed", revision: s.expectedRevision + 1 });
    });
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "甲");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    // 在途期间用户改了另一处（模拟「标题/模板选择」这类无关输入）。
    act(() => {
      result.current.form.setValue("basics.title", "新职位名");
    });

    await act(async () => {
      resolveFirst?.({ status: "committed", revision: 1 });
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(result.current.form.getValues("basics.title")).toBe("新职位名");
  });

  it("网络超时后重试一次：内容只提交一次（复用同一 mutationId）", async () => {
    const rec = makeSubmitter((s, call) => {
      if (call === 1) return Promise.reject(new Error("fetch failed"));
      return Promise.resolve({ status: "committed", revision: s.expectedRevision + 1 });
    });
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "李四");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(rec.submissions).toHaveLength(1);
    expect(result.current.session.status).toBe("error");

    // 用户重试同一个内容（未再编辑）。
    await act(async () => {
      await result.current.session.flush().catch(() => undefined);
    });

    expect(rec.submissions).toHaveLength(2);
    // 同一个 mutationId：服务端才能识别为重放而不是第二次修改。
    expect(rec.submissions[1].mutationId).toBe(rec.submissions[0].mutationId);
  });

  it("冲突时保留本地输入、状态为 conflict，并暴露当前 revision", async () => {
    const rec = makeSubmitter(() =>
      Promise.resolve({ status: "conflict", currentRevision: 7 }),
    );
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "本地新输入");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.session.status).toBe("conflict");
    expect(result.current.session.conflictRevision).toBe(7);
    // 本地输入必须保留 —— 不能因为冲突就丢掉用户写的东西。
    expect(result.current.form.getValues("basics.name")).toBe("本地新输入");
  });

  it("冲突后不发生覆盖式重试（不会一直打服务端）", async () => {
    const rec = makeSubmitter(() =>
      Promise.resolve({ status: "conflict", currentRevision: 7 }),
    );
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "本地新输入");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(rec.submissions).toHaveLength(1);
  });

  it("flush 在冲突时 reject，调用方不能把冲突当成功", async () => {
    const rec = makeSubmitter(() =>
      Promise.resolve({ status: "conflict", currentRevision: 3 }),
    );
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "x");
      result.current.session.schedule();
    });

    await act(async () => {
      await expect(result.current.session.flush()).rejects.toBeInstanceOf(MutationConflictError);
    });
  });

  it("rebase 用服务端最新 revision 重试，本地输入仍在", async () => {
    let attempt = 0;
    const rec = makeSubmitter((s) => {
      attempt += 1;
      if (attempt === 1) return Promise.resolve({ status: "conflict", currentRevision: 5 });
      return Promise.resolve({ status: "committed", revision: s.expectedRevision + 1 });
    });
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "本地输入");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(result.current.session.status).toBe("conflict");

    await act(async () => {
      result.current.session.rebase({
        content: initialContent(),
        revision: 5,
        title: "我的简历",
        templateId: "classic",
      });
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.session.status).toBe("idle");
    // 第二次提交基于新的 revision。
    expect(rec.submissions[1].expectedRevision).toBe(5);
    expect(result.current.form.getValues("basics.name")).toBe("本地输入");
  });

  it("本地无改动时 applyRemoteCommit 可以把服务端内容写进表单", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    const serverContent = ResumeContentSchema.parse({
      ...initialContent(),
      basics: { ...initialContent().basics, name: "服务端写的" },
    });

    act(() => {
      result.current.session.applyRemoteCommit({
        content: serverContent,
        revision: 3,
        applyContent: (content) => result.current.form.reset(content),
      });
    });

    expect(result.current.session.revision).toBe(3);
    expect(result.current.form.getValues("basics.name")).toBe("服务端写的");
  });

  it("本地有未保存输入时 applyRemoteCommit **不**覆盖表单", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "我还没保存的输入");
      result.current.session.schedule();
    });

    const serverContent = ResumeContentSchema.parse({
      ...initialContent(),
      basics: { ...initialContent().basics, name: "服务端写的" },
    });
    act(() => {
      result.current.session.applyRemoteCommit({
        content: serverContent,
        revision: 3,
        applyContent: (content) => result.current.form.reset(content),
      });
    });

    // 本地输入比新基准更新，不能被覆盖。
    expect(result.current.form.getValues("basics.name")).toBe("我还没保存的输入");
    // 但 revision 已经推进（服务端确实落盘了那次提交）。
    expect(result.current.session.revision).toBe(3);
  });

  it("服务端拒绝（结构异常）时状态为 rejected 且保留输入", async () => {
    const rec = makeSubmitter(() => Promise.resolve({ status: "rejected", code: "invalid_command" }));
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "x");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.session.status).toBe("rejected");
    expect(result.current.form.getValues("basics.name")).toBe("x");
  });

  it("条目缺稳定 ID 时拒绝并说明原因，不回退到下标提交", async () => {
    const rec = makeSubmitter();
    const legacy = ResumeContentSchema.parse({
      ...emptyResumeContent(),
      experience: [
        { company: "甲公司", title: "", start: "", end: "", location: "", content: doc("") },
      ],
    });

    const { result } = renderHook(() => {
      const form = useForm<ResumeContent>({ defaultValues: legacy });
      const session = useResumeMutationSession({
        initial: { content: legacy, revision: 0, title: "t", templateId: "classic" },
        getContent: () => form.getValues() as ResumeContent,
        getRow: () => ({ title: "t", templateId: "classic" }),
        submit: rec.submit,
        debounceMs: 50,
        newMutationId: () => "mut_x",
        newOpId: () => "op_x",
      });
      return { form, session };
    });

    act(() => {
      result.current.form.setValue("experience.0.company", "甲公司（改）");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(rec.submissions).toHaveLength(0);
    expect(result.current.session.status).toBe("rejected");
  });

  it("默认来源是 manual；setNextSource 只影响紧随其后的一次提交", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "第一次");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(rec.submissions[0].source).toBe("manual");

    // 协作同步把远端改动写进表单前，会先标注来源。
    act(() => {
      result.current.session.setNextSource("collab");
      result.current.form.setValue("basics.name", "来自协作者");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(rec.submissions[1].source).toBe("collab");

    // 标注只生效一次：随后的真实手动输入必须回到 manual，
    // 否则协作期间用户自己的编辑会被永久误归因。
    act(() => {
      result.current.form.setValue("basics.name", "我自己打的");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(rec.submissions[2].source).toBe("manual");
  });

  it("no_change 也推进基准（服务端确认无需改动）", async () => {
    const rec = makeSubmitter(() => Promise.resolve({ status: "no_change", currentRevision: 4 }));
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "x");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.session.status).toBe("idle");
    expect(result.current.session.revision).toBe(4);
  });

  it("连续编辑只提交最后一次（去抖）", async () => {
    const rec = makeSubmitter();
    const { result } = renderHook(() => useSession(rec.submit));

    act(() => {
      result.current.form.setValue("basics.name", "一");
      result.current.session.schedule();
      result.current.form.setValue("basics.name", "二");
      result.current.session.schedule();
      result.current.form.setValue("basics.name", "三");
      result.current.session.schedule();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(rec.submissions).toHaveLength(1);
  });
});
