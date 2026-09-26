import type { ResumeContent } from "@intro-builder/shared/schemas";

/**
 * 服务端提交回执 → 客户端内容同步（P07 任务 3 的关键接缝）。
 *
 * ## 为什么需要它
 *
 * 新旧两条路径的**写入位置不同**，这是切流最核心的差异：
 *
 * | | 旧路径（`/api/agent/floating/chat`） | 新路径（`/api/ai/runs`） |
 * |---|---|---|
 * | 谁写库 | **客户端**（组件调 `applyOperation` → 表单变更 → autosave 提交） | **服务端**（`commitToolProposal` → `commitResumeMutation`） |
 * | 留痕 | 依赖 autosave | 提交语句内原子完成 |
 * | 幂等/租约 | 无 | 有 |

 * 新路径里服务端已经写完库了，客户端**必须把自己的表单同步过去**，
 * 否则会出现「服务端已保存、界面还是旧内容」—— 用户刷新才发现变化，
 * 或者更糟：本地稍后的一次 autosave 用旧内容把服务端的修改**覆盖回去**。
 *
 * ## 一个关键事实：回执事件不带内容
 *
 * `mutation.committed` 的 payload 只有 `{ mutationId, revision, changeSetId }` ——
 * **没有内容**。这是有意的（事件流不该承载整份简历快照），但也意味着
 * 客户端**必须另外取内容**。
 *
 * 因此本模块的输入是「回执 + 另取的内容」：
 *
 * - 回执提供 `revision`（同步的 CAS 基准）；
 * - 内容由调用方用 `getResumeMutationBaseline(resumeId)` 取（服务端权威）。
 *
 * ## 为什么 revision 必须来自回执而不是本地推断
 *
 * `useResumeMutationSession` 的基准推进是**乐观**的（本地提交后自己 +1）。
 * 新路径下服务端可能因为并发而落在别的 revision 上（它有自己的 CAS）。
 * 用本地推断的值去同步，会让后续提交的 `expectedRevision` 与真实值错位 ——
 * 表现为「明明没冲突却报冲突」。
 */

/** 一次服务端提交回执。 */
export type CommittedReceipt = {
  mutationId: string;
  revision: number;
  changeSetId: string | null;
};

export type SyncPlan =
  /**
   * 应当把内容同步进表单。
   *
   * `revision` 是服务端权威值，调用方应把它交给
   * `mutationSession.applyRemoteCommit` 推进基准。
   */
  | { action: "sync"; revision: number; content: ResumeContent }
  /**
   * **只推进基准，不覆盖表单**：本地有未提交的编辑。
   *
   * 这条判据是防数据丢失的核心：若本地有 dirty 内容，把服务端内容
   * 直接写进表单会**抹掉用户刚敲的字**。此时把基准推到服务端内容、
   * 但表单保持用户的输入 —— 于是用户那次提交的 diff
   * （`buildMutationOperations(基准 → 表单)`）会**涵盖他的本地编辑**，
   * 由服务端的 CAS 决定是否冲突。
   *
   * `content` 是**服务端内容**（与 `sync` 同一份），不是本地内容。
   * 这一点是必须的：基准若不是服务端内容，用户的本地编辑会被当成
   * 「已保存」而**永不提交**（见下方 `planCommitSync` 的说明）。
   */
  | {
      action: "advance-baseline-only";
      revision: number;
      content: ResumeContent;
      reason: "local-edits";
    }
  /**
   * 需要重新拉取 baseline 后再同步。
   *
   * 两个原因分开：`missing-revision` 是回执本身不可用（不该发生，属契约违例）；
   * `missing-content` 是内容取不到（网络/越权，属可重试的失败）。
   * 合成一个码会让调用方无法决定「重试」还是「报错」。
   */
  | { action: "reload"; reason: "missing-revision" | "missing-content" };

/**
 * 决定如何处理一次服务端提交回执。
 *
 * 判据只有两条，但每条都对应一类真实的数据丢失：
 *
 * 1. **回执缺 revision** → 不猜，让调用方重拉。
 * 2. **本地有 dirty 编辑** → 只推进基准，不覆盖表单内容。
 */
export function planCommitSync(input: {
  receipt: CommittedReceipt;
  /** 服务端权威内容（调用方用 `getResumeMutationBaseline` 取）。 */
  serverContent: ResumeContent | null;
  /** 本地是否有未提交的编辑。 */
  hasLocalEdits: boolean;
}): SyncPlan {
  const revision = input.receipt.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    /*
     * **不猜 revision**。本地推断的值与服务端真实值错位会让后续提交
     * 出现「明明没冲突却报冲突」，而那种故障极难定位
     * （错误信息说冲突，但用户确实没改过）。
     */
    return { action: "reload", reason: "missing-revision" };
  }

  /*
   * **先检查内容是否可得，再决定分支。**
   *
   * 第一版把「有本地编辑」的判断放在内容检查之前，导致那条分支**不带内容**。
   * 于是调用方只能拿本地内容当基准 —— 而那是严重的数据丢失：
   *
   * 基准被设成「已含用户未保存编辑的本地内容」后，
   * `buildMutationOperations(基准 → 表单)` 会认为那些编辑**已经保存过**，
   * 于是它们**永远不会被提交**，而界面上看起来一切正常
   * （内容还在表单里、状态是 idle）。用户刷新后才发现改动没了。
   *
   * 因此两个分支都必须带上服务端内容：区别只在**表单要不要被覆盖**。
   */
  if (!input.serverContent) {
    /*
     * 拿不到权威内容时不猜。
     *
     * 用**不同的** reason 码：这是可重试的失败（网络/越权），
     * 与「回执契约违例」应当被调用方区别对待 ——
     * 前者提示用户重试，后者应当上报。
     */
    return { action: "reload", reason: "missing-content" };
  }

  if (input.hasLocalEdits) {
    /*
     * 有本地未提交编辑时**只推进基准**。
     *
     * 把服务端内容写进表单会抹掉用户正在敲的字 —— 那是不可接受的数据丢失。
     * 但基准**必须**是服务端内容：这样用户那次提交的 diff 会涵盖他的本地编辑，
     * 由服务端的 CAS 决定是否冲突（而不是把它们当成已保存而丢弃）。
     */
    return { action: "advance-baseline-only", revision, content: input.serverContent, reason: "local-edits" };
  }

  return { action: "sync", revision, content: input.serverContent };
}

/**
 * 从一批动作里挑出最近一次回执的 revision。
 *
 * 一次 Run 可能提交多次（多个工具各自提交）。同步只应针对**最后一次** ——
 * 中间态的 revision 已经过时，用它推进基准会让本地落后于服务端。
 */
export function latestCommittedRevision(
  actions: readonly { kind: string; revision?: number | null }[],
): number | null {
  let latest: number | null = null;
  for (const action of actions) {
    if (action.kind !== "committed") continue;
    const revision = action.revision;
    if (typeof revision !== "number") continue;
    if (latest === null || revision > latest) latest = revision;
  }
  return latest;
}
