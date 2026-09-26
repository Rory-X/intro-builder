import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { RunEventEnvelope } from "@intro-builder/shared/types";

import { planCommitSync, type SyncPlan } from "./commit-sync";
import {
  adaptRunEventToAction,
  type AdaptedQuestion,
  type AdaptedStreamAction,
  type AdaptedToolCall,
  type EndStatus,
} from "./floating-adapter";
import { createRunProjection, reduceRunEvent, type RunProjection } from "./reducer";
import { streamRun, resumeRun, type StreamRunResult } from "./run-stream";
import { projectTaskCard, type TaskCard } from "./task-projection";

/**
 * 浮窗切流的协调层（P07 任务 3）。
 *
 * ## 为什么需要这一层
 *
 * 前面几个提交把切流所需的**零件**都建好了，但它们是分开的：
 *
 * - `run-stream`：网络层（发起、消费 SSE、幂等复用分支、续读）；
 * - `floating-adapter`：协议翻译（新 Run 事件 → 浮窗动作）；
 * - `commit-sync`：服务端写库后如何同步客户端内容；
 * - `task-projection`：任务卡；
 * - `reducer`：唯一投影来源。
 *
 * 没有协调层时，`floating-agent-chat.tsx`（2511 行）要**同时**处理
 * 「替换 fetch 目标」「逐条翻译事件」「判断是否同步内容」「维护投影」——
 * 那是把五件事揉进一个大组件，既难测也难回滚。
 *
 * 本层把它们串成**一个可注入的会话对象**：组件只需
 * `createFloatingRun(...)` 一次，然后按回调更新状态。
 *
 * ## 与组件现有回调的对应关系
 *
 * 刻意让回调命名与组件既有的 `readFloatingAgentStream` 一致
 * （`onTextDelta` / `onToolCall` / `onQuestionRequest`），
 * 这样切流时组件的状态更新逻辑**不用改** —— 只换数据来源。
 * `AdaptedToolCall` / `AdaptedQuestion` 的形状也与组件的
 * `FloatingAgentToolCall` / `FloatingQuestionRequest` 逐字段一致。
 */

/** 协调层对外暴露的回调。命名与组件既有的流回调保持一致。 */
export type FloatingRunHandlers = {
  /** 增量文本。 */
  onTextDelta: (delta: string) => void;
  /** 工具卡新增或更新（按 id 去重）。 */
  onToolCall: (toolCall: AdaptedToolCall) => void;
  /** 需要用户回答的问题。 */
  onQuestion: (question: AdaptedQuestion) => void;
  /** 提案就绪（调用方去拉 changeSet 并渲染提案卡）。 */
  onProposal: (proposal: { changeSetId: string; proposalVersion: number; summary: string }) => void;
  /** 文档**真的落盘了**（唯一能驱动「已保存」的依据）。 */
  onCommitted: (receipt: { mutationId: string; revision: number | null }) => void;
  /** 冲突，需要用户处理。 */
  onConflict: (conflict: { mutationId: string; message: string }) => void;
  /** 终态。`waiting_user` 也算（那一轮助手说完了话并抛出问题）。 */
  onEnded: (status: EndStatus, reason: string | null) => void;
  /** 投影更新（已去重、已应用终态保护）。 */
  onProjection: (projection: RunProjection) => void;
  /** 任务卡更新（同一份事件的用户可见投影）。 */
  onTaskCard: (card: TaskCard) => void;
  /**
   * 服务端写库后请求同步客户端内容。
   *
   * 调用方在此决定是否写表单（本层给出 `SyncPlan`，但**不**直接改表单 ——
   * 那需要 `form.reset` 之类的具体能力，属于组件/编辑器的职责）。
   */
  onSyncNeeded: (plan: SyncPlan) => void;
};

/** 发起一次浮窗 Run 的输入。 */
export type FloatingRunInput = {
  resumeId: string;
  message: string;
  /** 幂等键。同一 requestId 不会二次调用模型。 */
  requestId: string;
  /** CAS 基准。从 `mutationSession.getBaseline().revision` 取。 */
  revision: number;
  writeMode: "direct" | "approval";
  sessionId?: string | null;
  mode?: "optimize_existing" | "create_from_zero";
  modelConfig: { baseUrl: string; apiKey: string; modelName: string };
  /** 本轮之前的对话历史（多轮会话必须传，否则每轮失忆）。 */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
};

/** 协调层的产出。 */
export type FloatingRunOutcome =
  | {
      status: "finished";
      endStatus: EndStatus | null;
      /** 最后一次提交的 revision（无提交时为 null）。 */
      lastRevision: number | null;
      /** 服务端权威内容（调用方用它同步表单）。 */
      serverContent: ResumeContent | null;
      /** 本地是否有未提交编辑（决定能否覆盖表单）。 */
      hasLocalEdits: boolean;
    }
  | { status: "reused"; runId: string }
  | { status: "error"; code: string; message: string };

/**
 * 会话对象：把一次浮窗运行的状态与回调绑在一起。
 *
 * 组件持有它即可 —— 不必自己维护 reducer 状态、任务卡或提交累计。
 */
export type FloatingRunSession = {
  /** 发起（或按幂等键复用）一次运行。 */
  start: (input: FloatingRunInput) => Promise<FloatingRunOutcome>;
  /** 续读一个 Run（刷新恢复）。 */
  resume: (runId: string, after?: number) => Promise<FloatingRunOutcome>;
  /** 当前投影（随时可读，供渲染）。 */
  getProjection: () => RunProjection;
  /** 当前任务卡。 */
  getTaskCard: () => TaskCard;
};

/**
 * 创建一次浮窗会话。
 *
 * `deps` 可注入（测试用）：默认走真实网络与真实内容读取。
 */
export function createFloatingRun(
  handlers: FloatingRunHandlers,
  deps: {
    /**
     * 读取服务端权威内容。
     *
     * 生产上接到 `getResumeMutationBaseline(resumeId)`。
     * 返回 null 表示取不到（网络/越权）—— 协调层会据此给出 `reload` 方案。
     */
    loadServerContent?: (resumeId: string) => Promise<ResumeContent | null>;
    /** 本地是否有未提交编辑。生产上读 `mutationSession` 的 dirty 状态。 */
    hasLocalEdits?: () => boolean;
  } = {},
): FloatingRunSession {
  let projection = createRunProjection();
  let taskCard = projectTaskCard([]);
  let latestRevision: number | null = null;
  let sawCommit = false;
  let endStatus: EndStatus | null = null;

  /**
   * 处理一条事件：翻译 → 分发回调。
   *
   * **刻意不在这里折叠 reducer**。`streamRun` / `consumeRunStream` 内部已经
   * 用 `reduceRunEvent` 折叠，并通过 `onProjection` 回调交出来。
   *
   * 我第一版在这里又折叠了一遍 —— 结果是**两份投影同时存在**，
   * 而其中一份（内部那份）被丢弃。那不仅是白做的计算，更危险的是：
   * 两份投影的去重规则一旦不一致（例如我只用 eventId 而内部还用 sequence），
   * 就会得出互相矛盾的结论，而排查时无法判断是哪一份在起作用。
   *
   * 唯一投影来源就是 `onProjection` 给的那份。
   */
  function handleEvent(event: RunEventEnvelope): void {
    const action = adaptRunEventToAction(event);
    if (action) dispatchAction(action);
  }

  /** 把翻译结果分发给对应回调。 */
  function dispatchAction(action: AdaptedStreamAction): void {
    switch (action.kind) {
      case "text":
        handlers.onTextDelta(action.delta);
        break;
      case "tool":
        handlers.onToolCall(action.toolCall);
        break;
      case "question":
        handlers.onQuestion(action.question);
        break;
      case "proposal":
        handlers.onProposal({
          changeSetId: action.changeSetId,
          proposalVersion: action.proposalVersion,
          summary: action.summary,
        });
        break;
      case "committed":
        sawCommit = true;
        /*
         * 取**最大** revision：一次 Run 可能提交多次，
         * 用中间态推进基准会让本地落后（后续提交会被 CAS 拒绝）。
         */
        if (action.revision !== null && (latestRevision === null || action.revision > latestRevision)) {
          latestRevision = action.revision;
        }
        handlers.onCommitted({ mutationId: action.mutationId, revision: action.revision });
        break;
      case "conflict":
        handlers.onConflict({ mutationId: action.mutationId, message: action.message });
        break;
      case "ended":
        endStatus = action.status;
        handlers.onEnded(action.status, action.reason);
        break;
    }
  }

  /** 每批事件处理后刷新任务卡。 */
  function refreshTaskCard(events: readonly RunEventEnvelope[]): void {
    const next = projectTaskCard(events);
    // 只在变化时回调，避免无意义的渲染。
    if (JSON.stringify(next) !== JSON.stringify(taskCard)) {
      taskCard = next;
      handlers.onTaskCard(taskCard);
    }
  }

  /** 收尾：处理提交同步。 */
  async function finalize(input: {
    resumeId: string;
    events: readonly RunEventEnvelope[];
  }): Promise<FloatingRunOutcome> {
    refreshTaskCard(input.events);

    /*
     * 有提交时请求同步内容。
     *
     * **只有真的有回执才同步**（`sawCommit`）—— 诊断类任务没有回执，
     * 也就没有「服务端改过内容」这回事，不该触发任何表单操作。
     */
    let resolvedContent: ResumeContent | null = null;
    if (sawCommit && deps.loadServerContent) {
      try {
        resolvedContent = await deps.loadServerContent(input.resumeId);
      } catch {
        /*
         * 取不到内容时**不抛**：协调层的职责是如实给出 `reload(missing-content)`
         * 方案，让调用方决定重试还是提示。抛异常会把一个可恢复的情况
         * 变成一次运行失败。
         */
        resolvedContent = null;
      }
      const localEdits = deps.hasLocalEdits?.() ?? false;
      const plan = planCommitSync({
        receipt: {
          mutationId: "",
          revision: latestRevision ?? Number.NaN,
          changeSetId: null,
        },
        serverContent: resolvedContent,
        hasLocalEdits: localEdits,
      });
      handlers.onSyncNeeded(plan);
    }

    return {
      status: "finished",
      endStatus,
      lastRevision: latestRevision,
      /*
       * 如实返回取到的内容 —— 调用方可能需要在 `onSyncNeeded` 之外
       * 也拿到它（例如自行决定何时 reset 表单）。
       * 我第一版这里写死 `null`（明明算出来了却不返回），
       * 那会让调用方只能依赖回调、无法在结果里取用。
       */
      serverContent: resolvedContent,
      hasLocalEdits: deps.hasLocalEdits?.() ?? false,
    };
  }

  return {
    async start(input) {
      const collected: RunEventEnvelope[] = [];

      const result = await streamRun(
        {
          resumeId: input.resumeId,
          message: input.message,
          requestId: input.requestId,
          revision: input.revision,
          mode: input.mode ?? "optimize_existing",
          writeMode: input.writeMode,
          sessionId: input.sessionId ?? null,
          history: input.history,
          modelConfig: input.modelConfig,
          signal: input.signal,
        },
        {
          onEvent: (event) => {
            collected.push(event);
            handleEvent(event);
          },
          /*
           * 投影从**这里**取（网络层已经折叠过）。
           *
           * 必须真的存下来：`getProjection()` 要能返回当前状态。
           * 我第一版把它写成空函数 —— 那样 `getProjection()` 永远返回初始空投影，
           * 而调用方会以为「什么事件都没发生」。
           */
          onProjection: (next) => {
            projection = next;
            handlers.onProjection(next);
          },
          onDone: () => {},
        },
      );

      if (result.status === "error") {
        return { status: "error", code: result.code, message: result.message };
      }
      if (result.status === "reused") {
        /*
         * 幂等命中：服务端没返回事件流，而是告知「去读事件流（GET）」。
         * 这里**如实返回 reused**，让调用方决定是续读还是提示用户 ——
         * 假装它是一次正常完成会让界面显示「已完成」而内容从未更新。
         */
        return { status: "reused", runId: result.runId };
      }

      return finalize({ resumeId: input.resumeId, events: collected });
    },

    async resume(runId, after) {
      const collected: RunEventEnvelope[] = [];
      const result = await resumeRun({ runId, ...(after === undefined ? {} : { after }) });
      if (result.status === "error") {
        return { status: "error", code: result.code, message: result.message };
      }
      for (const event of result.events) {
        collected.push(event);
        handleEvent(event);
        /*
         * `resumeRun` 是普通 JSON 请求（不是 SSE），因此这里没有网络层
         * 帮忙折叠 —— 需要自己用 reducer 折叠。这是**唯一**的例外，
         * 且 reason 明确：数据来源不同（一次性数组 vs 流）。
         */
        const folded = reduceRunEvent(projection, event);
        if (folded.changed) {
          projection = folded.state;
          handlers.onProjection(projection);
        }
      }
      /*
       * 续读拿不到 resumeId（GET 只返回事件），因此这里不做内容同步 ——
       * 调用方若需要，应当在拿到 resumed 结果后自行拉 baseline。
       * 刻意**不**从事件里猜 resumeId：那属于猜测。
       */
      refreshTaskCard(collected);
      return {
        status: "finished",
        endStatus,
        lastRevision: latestRevision,
        serverContent: null,
        hasLocalEdits: deps.hasLocalEdits?.() ?? false,
      };
    },

    getProjection: () => projection,
    getTaskCard: () => taskCard,
  };
}

/**
 * 判断一次结果是否**需要调用方续读**。
 *
 * 幂等复用与「服务端仍在跑」这两种情况都要求调用方去读事件流。
 * 单独成函数是为了让组件有明确判据，而不是在各处比较字符串。
 */
export function needsResume(
  outcome: StreamRunResult | FloatingRunOutcome,
): outcome is Extract<FloatingRunOutcome, { status: "reused" }> {
  return outcome.status === "reused";
}
