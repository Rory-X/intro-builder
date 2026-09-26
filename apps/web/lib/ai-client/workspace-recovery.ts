import type { RunEventEnvelope, RunStatus } from "@intro-builder/shared/types";

import { createRunProjection, reduceRunEvents, type RunProjection } from "./reducer";
import { projectTaskCard, type TaskCard } from "./task-projection";

/**
 * 刷新后的恢复与错误文案（P06 任务 6）。
 *
 * plan 要求两件事：
 *
 * 1. **恢复后还原**已完成工具、已应用/已拒绝建议及等待问题；
 *    **重放 event 不重复 toast/写入**。
 * 2. 四类错误都有**可操作中文文案**：无终态 EOF、没有模型 key、
 *    未完成保存、找不到条目。
 *
 * ## 「重放不重复」的分工
 *
 * 去重**不在这里**：`reducer.ts` 已经有两层机制（`seenEventIds` 与
 * `sequence` 单调性），且它是权威。本模块只负责把**已经去重过的**投影
 * 转成 UI 需要的形状 —— 若在这里再去重一次，两处规则不一致时会得出
 * 互相矛盾的结论，而排查时很难判断是哪一层放行了重复事件。
 *
 * 本模块确实需要保证的一件事：**同样的输入产生同样的输出**
 * （纯函数），这样「刷新后重放同一批事件」不会让界面状态漂移。
 */

/** 恢复后的工作区状态。这是刷新页面后「界面应该长什么样」的完整描述。 */
export type WorkspaceSnapshot = {
  /** 机器投影（工具、提案、决策、冲突）。 */
  projection: RunProjection;
  /** 面向用户的任务卡。 */
  taskCard: TaskCard;
  /** 是否还需要用户回答某个问题（刷新后要重新聚焦）。 */
  awaitingQuestion: { questionId: string; question: string } | null;
  /**
   * 恢复时是否需要提示用户「连接中断」。
   *
   * 只在「流结束但没收到结束事件」时为 true —— 那是真的断线，
   * 而不是「模型做完了」。
   */
  interrupted: boolean;
  /**
   * 已完成但**未确认落盘**的修改数。
   *
   * 用户最需要知道的一件事：有没有「看起来做完了但没保存」的改动。
   */
  unconfirmedWrites: number;
};

/**
 * 从事件流恢复工作区状态。
 *
 * `runStatus` 由服务端提供（GET /runs/:id 的结果）。它比本地事件流更权威：
 * 本地可能只缓存了部分事件（刷新后重放不完整），而服务端知道 Run 的真实状态。
 * 因此当两者不一致时，**以服务端为准**并保留本地已知的细节。
 */
export function restoreWorkspace(input: {
  events: readonly RunEventEnvelope[];
  runStatus: RunStatus | null;
}): WorkspaceSnapshot {
  /*
   * `reduceRunEvents` 的签名是 `(初始状态, 事件数组)`，返回包装对象
   * （含 appliedCount，用于「是否真的变了」判断）。
   * 因此需先构造初始投影，再折叠事件。
   */
  const projection = reduceRunEvents(createRunProjection(), [...input.events]).state;
  const taskCard = projectTaskCard(input.events);

  /*
   * 服务端状态优先。
   *
   * 本地事件流可能不完整（刷新时只重放了一部分），此时本地的
   * 「还在运行中」是错的 —— 服务端早已结束。反过来，服务端说「运行中」
   * 而本地收到过 EOF，说明是**连接**断了而不是 Run 结束了：
   * 这种情况保持 interrupted，让用户知道可以重连。
   */
  let status = projection.status;
  if (input.runStatus) {
    /*
     * 服务端的**终态**无条件优先，包括覆盖本地的 `interrupted`。
     *
     * 我第一版写成了 `completed && status !== "interrupted"` —— 方向错了。
     * 事件流里的 `run.interrupted` 记录的是**某一次 attempt** 被中断
     * （EOF / 超时），而 Run 之后可能被别的 attempt 完成，或者被
     * reconciliation 归为已完成。服务端 `GET /runs/:id` 返回的是 Run 的
     * 最终状态，比事件流里的一次 attempt 更权威。
     *
     * 若在这里让本地 interrupted 覆盖服务端 completed，用户会看到
     * 「连接中断，未完成」—— 但内容其实已经保存好了。那是虚报失败。
     */
    if (input.runStatus === "completed") status = "completed";
    else if (input.runStatus === "failed") status = "failed";
    else if (input.runStatus === "cancelled") status = "cancelled";
    else if (input.runStatus === "waiting_user") status = "waiting_user";
    else if (input.runStatus === "running") status = projection.status;
    // 其它未知值不改动本地判断。
  }

  /*
   * 「断线」的判据：本地收到过中断标记，且服务端**没有**给出终态结论。
   *
   * 服务端说 completed 时这不算断线（真正的完成）；服务端说 running
   * 而本地 EOF 时才算 —— 那是连接问题而不是 Run 结束。
   */
  const serverConcluded =
    input.runStatus === "completed" ||
    input.runStatus === "failed" ||
    input.runStatus === "cancelled";
  const interrupted =
    projection.status === "interrupted" && !serverConcluded ||
    (status === "interrupted" && !serverConcluded);

  const restoredTaskCard: TaskCard =
    status === taskCard.status ? taskCard : { ...taskCard, status: mapStatus(status) };

  return {
    projection: { ...projection, status },
    taskCard: restoredTaskCard,
    awaitingQuestion: projection.pendingQuestion
      ? {
          questionId: projection.pendingQuestion.questionId,
          question: projection.pendingQuestion.question,
        }
      : null,
    interrupted,
    /*
     * 「未确认落盘」= 有提案、有工具成功执行，但**没有任何回执**。
     * 这三者的组合正是「看起来做完了但可能没保存」的场景。
     */
    unconfirmedWrites:
      projection.committed.length === 0 && projection.tools.some((tool) => tool.status === "succeeded")
        ? projection.tools.filter((tool) => tool.status === "succeeded").length
        : 0,
  };
}

/**
 * 投影状态 → 任务卡状态。
 *
 * 入参含 `"idle"`（未收到任何事件）：投影与任务卡面向不同读者，
 * 因此是两个枚举，中间需要显式映射而不是强转。
 */
function mapStatus(status: RunStatus | "idle"): TaskCard["status"] {
  switch (status) {
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "waiting_user":
      return "waiting_user";
    case "interrupted":
      return "interrupted";
    case "running":
      return "running";
    case "idle":
    default:
      return "idle";
  }
}

/** 可操作的错误种类。plan 点名的四类。 */
export type WorkspaceErrorKind =
  | "no_end_event"
  | "missing_model_key"
  | "unconfirmed_save"
  | "target_not_found"
  | "unknown";

/**
 * 把错误情况翻成**可操作**的中文。
 *
 * 每一条都必须让用户知道**下一步做什么**。只说「出错了」等于没说 ——
 * 用户既不知道要不要重试，也不知道自己的内容有没有丢。
 */
export function describeWorkspaceError(kind: WorkspaceErrorKind): string {
  switch (kind) {
    case "no_end_event":
      /*
       * 无终态 EOF。这不是「失败」而是「连接断了」——
       * 用户的改动可能已经保存了（若收到过回执），也可能没有。
       * 因此文案要同时给出「当前状态」与「下一步」。
       */
      return "连接中断，本次回复没有完整结束。已经保存的修改不受影响，可以重新发送这条消息。";
    case "missing_model_key":
      // 这是配置问题，用户能自己解决 —— 给出具体入口。
      return "还没有配置模型访问密钥，请到设置里连接模型服务后再试。";
    case "unconfirmed_save":
      /*
       * 最关键的一条：模型做完了但**没有落盘回执**。
       * 必须明确说「还没保存」，否则用户会以为内容已经写进去了，
       * 刷新后才发现丢掉。
       */
      return "这次修改还没有保存成功，内容没有写入简历。可以重试，或先复制下来再手动粘贴。";
    case "target_not_found":
      return "要修改的内容已经找不到了（可能已被删除或在别处改过）。请刷新页面后重新发送。";
    default:
      return "操作没有完成。你可以重试；如果反复失败，请刷新页面后重试。";
  }
}

/**
 * 由工作区快照推断「当前最该提示哪一类错误」。
 *
 * 顺序是刻意的：先看有没有**真的出错**（找不到条目），再看**配置**，
 * 再看**断线**，最后才是「未确认保存」。
 *
 * 理由：前几类会让用户的操作根本无法完成，而「未确认保存」是在
 * 操作已经发生之后才需要提示的 —— 先说前者能让用户少走弯路。
 */
export function inferWorkspaceError(
  snapshot: WorkspaceSnapshot,
  options: { hasModelKey: boolean },
): WorkspaceErrorKind | null {
  // 找不到条目：工具失败里有对应错误码。
  const hasTargetMissing = snapshot.projection.tools.some(
    (tool) => tool.status === "failed" && tool.errorCode === "target_not_found",
  );
  if (hasTargetMissing) return "target_not_found";

  // 缺模型密钥：配置问题，用户能自己修。
  if (!options.hasModelKey) return "missing_model_key";

  // 断线：Run 还没结束但流断了。
  if (snapshot.interrupted) return "no_end_event";

  /*
   * 未确认保存：工具跑完了、有提案，但没有任何回执。
   *
   * 注意与「诊断类任务」的区分：诊断只读、本来就不该有回执，
   * 因此要求「有提案」作为前提 —— 只有产生了修改意图却没有落盘回执，
   * 才是「未确认保存」。
   */
  if (snapshot.unconfirmedWrites > 0 && snapshot.projection.proposals.length > 0) {
    return "unconfirmed_save";
  }

  return null;
}
