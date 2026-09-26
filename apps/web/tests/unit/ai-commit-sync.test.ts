import { describe, expect, it } from "vitest";
import { emptyResumeContent, ResumeContent } from "@intro-builder/shared/schemas";

import { latestCommittedRevision, planCommitSync } from "@/lib/ai-client/commit-sync";

/**
 * 服务端回执 → 客户端内容同步（P07 任务 3 的关键接缝）。
 *
 * ## 为什么这个模块存在
 *
 * 新旧两条路径的**写入位置不同**：
 *
 * - 旧路径：**客户端**写库（组件调 `applyOperation` → 表单变更 → autosave）
 * - 新路径：**服务端**写库（`commitToolProposal` → `commitResumeMutation`）
 *
 * 服务端写完库后，客户端必须同步自己的表单，否则会：
 * - 显示旧内容（用户刷新才发现变化）；或
 * - 更糟：本地稍后的 autosave 用旧内容把服务端修改**覆盖回去**。
 *
 * ## 一个关键事实
 *
 * `mutation.committed` 事件**不带内容**（只有 mutationId / revision /
 * changeSetId）。因此内容必须**另外取**（`getResumeMutationBaseline`）——
 * 本模块的输入就是「回执 + 另取的内容」。
 */

function content(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    basics: { ...emptyResumeContent().basics, name: "林可" },
  });
}

describe("同步决策", () => {
  it("无本地编辑 + 有内容 → 同步", () => {
    const plan = planCommitSync({
      receipt: { mutationId: "m-1", revision: 5, changeSetId: null },
      serverContent: content(),
      hasLocalEdits: false,
    });
    expect(plan.action).toBe("sync");
    if (plan.action === "sync") {
      // revision 来自回执（服务端权威），不是本地推断。
      expect(plan.revision).toBe(5);
      expect(plan.content.basics.name).toBe("林可");
    }
  });

  it("**有本地编辑时只推进基准，不覆盖表单**（防抹掉用户刚敲的字）", () => {
    const plan = planCommitSync({
      receipt: { mutationId: "m-1", revision: 5, changeSetId: null },
      serverContent: content(),
      hasLocalEdits: true,
    });
    /*
     * 这条是防数据丢失的核心：把服务端内容直接写进表单会抹掉用户正在输入的
     * 内容。此时推进基准即可 —— 本地那次提交会带着新基准提交，
     * 若真冲突由服务端 CAS 如实返回，走既有冲突 UI。
     */
    expect(plan).toEqual({
      action: "advance-baseline-only",
      revision: 5,
      reason: "local-edits",
    });
    expect(plan).not.toHaveProperty("content");
  });

  it("**回执缺 revision → reload（missing-revision）**，不猜", () => {
    // 本地推断的 revision 与服务端真实值错位会让后续提交「明明没冲突却报冲突」。
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const plan = planCommitSync({
        receipt: { mutationId: "m-1", revision: bad, changeSetId: null },
        serverContent: content(),
        hasLocalEdits: false,
      });
      expect(plan, String(bad)).toEqual({ action: "reload", reason: "missing-revision" });
    }
  });

  it("**取不到内容 → reload（missing-content）**，且与契约违例区分开", () => {
    const plan = planCommitSync({
      receipt: { mutationId: "m-1", revision: 5, changeSetId: null },
      serverContent: null,
      hasLocalEdits: false,
    });
    /*
     * 两个 reason 码分开：missing-content 是可重试失败（网络/越权），
     * missing-revision 是契约违例（应当上报）。合成一个码会让调用方
     * 无法决定「提示重试」还是「报错」。
     */
    expect(plan).toEqual({ action: "reload", reason: "missing-content" });
  });

  it("**有本地编辑时即使取不到内容也不 reload**（基准仍要推进）", () => {
    const plan = planCommitSync({
      receipt: { mutationId: "m-1", revision: 5, changeSetId: null },
      serverContent: null,
      hasLocalEdits: true,
    });
    // 缺内容不该阻塞基准推进 —— 否则本地后续提交会一直用旧基准。
    expect(plan).toEqual({
      action: "advance-baseline-only",
      revision: 5,
      reason: "local-edits",
    });
  });
});

describe("多次提交只取最后一次 revision", () => {
  it("**取最大 revision**（中间态已过时，用它推进基准会让本地落后）", () => {
    const revision = latestCommittedRevision([
      { kind: "committed", revision: 3 },
      { kind: "committed", revision: 7 },
      { kind: "committed", revision: 5 },
    ]);
    expect(revision).toBe(7);
  });

  it("忽略非 committed 动作", () => {
    const revision = latestCommittedRevision([
      { kind: "text" },
      { kind: "tool" },
      { kind: "committed", revision: 4 },
      { kind: "ended" },
    ]);
    expect(revision).toBe(4);
  });

  it("忽略缺 revision 的 committed", () => {
    const revision = latestCommittedRevision([
      { kind: "committed", revision: null },
      { kind: "committed", revision: 2 },
    ]);
    expect(revision).toBe(2);
  });

  it("**没有回执时返回 null**（调用方据此不做同步）", () => {
    expect(latestCommittedRevision([{ kind: "text" }, { kind: "tool" }])).toBeNull();
    expect(latestCommittedRevision([])).toBeNull();
  });

  it("单次提交时返回它", () => {
    expect(latestCommittedRevision([{ kind: "committed", revision: 1 }])).toBe(1);
  });
});

describe("诚实性：不假装已同步", () => {
  it("reload 分支**不带 content**（避免调用方误用空内容）", () => {
    const plan = planCommitSync({
      receipt: { mutationId: "m-1", revision: 0, changeSetId: null },
      serverContent: content(),
      hasLocalEdits: false,
    });
    expect(plan).not.toHaveProperty("content");
  });

  it("只有 sync 分支才返回内容", () => {
    const synced = planCommitSync({
      receipt: { mutationId: "m-1", revision: 2, changeSetId: null },
      serverContent: content(),
      hasLocalEdits: false,
    });
    expect(synced).toHaveProperty("content");

    const notSynced = planCommitSync({
      receipt: { mutationId: "m-1", revision: 2, changeSetId: null },
      serverContent: content(),
      hasLocalEdits: true,
    });
    expect(notSynced).not.toHaveProperty("content");
  });
});
