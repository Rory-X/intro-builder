import type { RunEventType } from "@intro-builder/shared/types";
import type { ResumeContent, SemanticOperation } from "@intro-builder/shared/schemas";

import { AI_REQUEST_LIMITS } from "./provider-policy";
import type { BusinessEventDraft, SdkStreamPart, StreamAdapterOptions } from "./stream-adapter";
import {
  adaptStreamPart,
  finalizeAttempt,
  finalizeOnInterrupt,
  isAttemptEndDraft,
} from "./stream-adapter";
import { createWorkspace, type WorkspaceSnapshot, type WorkspaceSource } from "./workspace";
import { assertSingleAttemptEnd } from "./events";

/**
 * Run 的**编排层**（P04 任务 2 + 4）。
 *
 * 这一层是「模型 → 工具 → 提交 → 回执」的接线处。它刻意把所有外部依赖
 * （模型调用、文档提交、持久化）都做成**注入的接口**，原因有三个：
 *
 * 1. 测试能覆盖完整的业务流（含失败与取消），而不需要真实模型；
 * 2. 业务预期固定不变，SDK / 存储适配器可替换（plan 明确要求）；
 * 3. 强制把「什么必须在服务端做」写清楚 —— 提交、fencing、事件持久化都不能下放到客户端。
 *
 * 本模块**不**直接 import `@/db` 或 AI SDK，因此它可以被单元测试完全驱动。
 */

/** 一次执行的有界预算。 */
export type RunBudget = {
  maxSteps: number;
  deadlineMs: number;
};

export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxSteps: AI_REQUEST_LIMITS.maxSteps,
  deadlineMs: AI_REQUEST_LIMITS.routeDeadlineMs,
};

/** 工具执行结果。写工具**只能**通过提交模块改变文档。 */
export type ToolExecutionResult =
  | {
      status: "succeeded";
      /** 面向模型的结果（不含凭据）。 */
      result: Record<string, unknown>;
      /**
       * 若该工具产生了文档修改，这里是**真实提交回执**。
       * 没有这个字段就说明没有落盘 —— 模型不能据此声称「已保存」。
       */
      mutationId?: string;
      revision?: number;
      changeSetId?: string;
    }
  | { status: "failed"; code: string; message: string }
  /** 工具产出提案，按授权模式等待批准或直接提交。 */
  | {
      status: "proposed";
      changeSetId: string;
      proposalVersion: number;
      operations: SemanticOperation[];
      summary: string;
    }
  | { status: "asked"; question: { questionId: string; question: string; target?: string } };

/** 编排层需要的外部能力。全部可注入。 */
export type RunDeps = {
  /** 读取权威基准（服务端）。 */
  loadWorkspaceSource: (input: { runId: string; resumeId: string; userId: string }) => Promise<WorkspaceSource>;
  /** 调用模型并返回 SDK 片段流。 */
  streamModel: (input: {
    system: string;
    messages: unknown[];
    tools: unknown;
    abortSignal: AbortSignal;
    maxSteps: number;
  }) => AsyncIterable<SdkStreamPart>;
  /** 执行一个工具调用。写工具内部必须调用提交模块。 */
  executeTool: (input: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    workspace: WorkspaceSnapshot;
    writeMode: "direct" | "approval";
    /**
     * 本次执行所属 Run 的 fencing 令牌。
     *
     * 工具**必须**把它透传给 `commitResumeMutation`，让数据库在提交语句内
     * 核验「仍可写」。编排层在工具执行前也会查一次 `isWritable`，但那只减少
     * 无效工作；真正的裁决在提交语句里（取消与提交可能并发）。
     */
    fence: { runId: string; fenceToken: number } | null;
  }) => Promise<ToolExecutionResult>;
  /** 持久化业务事件（数据库分配 sequence）。 */
  emitEvent: (draft: BusinessEventDraft) => Promise<void>;
  /** 提交前的 fencing 核验：取消/接管后必须为 false。 */
  isWritable: () => Promise<boolean>;
  /** 取消检查（内存侧的快速判断，权威判断仍是 isWritable）。 */
  isCancelled: () => boolean;
  /** 是否应进入等待用户（例如本 attempt 已有 askUser）。 */
  shouldWaitForUser: () => boolean;
  /** 传给模型的系统提示。 */
  buildSystemPrompt: (input: { writeMode: "direct" | "approval" }) => string;
  /** 待发送的对话历史。 */
  buildMessages: (input: { workspace: WorkspaceSnapshot; history: unknown[] }) => unknown[];
  /** 可用工具的 SDK 描述。 */
  buildTools: (input: { writeMode: "direct" | "approval" }) => unknown;
  now?: () => number;
};

export type RunOrchestrationInput = {
  runId: string;
  resumeId: string;
  userId: string;
  attemptId: string;
  writeMode: "direct" | "approval";
  history?: unknown[];
  /**
   * 本 attempt 持有的 fenceToken。
   *
   * 由调用方在获取租约后填入；`null` 表示这次执行不持有租约（例如只读诊断），
   * 此时工具内的提交不带 fence 保护 —— 调用方应确保这种执行不产生写入。
   */
  fenceToken?: number | null;
  budget?: RunBudget;
  /** 取消信号：由路由在连接关闭或收到 cancel 时 abort。 */
  abortSignal: AbortSignal;
};

export type RunOrchestrationResult = {
  /** attempt 的结束类型（一定是五个结束事件之一）。 */
  endType: RunEventType;
  /** 已产生的业务事件数（用于观测与测试断言）。 */
  emitted: number;
  /** 是否收到过真实的提交回执。 */
  committed: boolean;
  /** 最后一个提交回执（若有）。 */
  lastReceipt: { mutationId: string; revision: number } | null;
  /** 工具执行摘要（不含参数正文）。 */
  tools: Array<{ toolName: string; status: ToolExecutionResult["status"] }>;
};

/**
 * 执行一个 attempt。
 *
 * 关键行为（每条都对应一个契约要求）：
 *
 * - **删除无效工具**：工具执行结果决定事件类型，不把所有工具硬编码成 completed。
 * - **提交前核验 fencing**：工具若声称已提交，必须再确认 Run 仍可写；
 *   否则（例如期间被取消）不得把这次修改当作已落盘。
 * - **一个 attempt 只有一个结束事件**：`finalizeAttempt` 是唯一出口；
 *   流中途出现结束类事件也不再补第二个。
 * - **不因 finish 推断完成**：SDK 的 `finish` 不产生结束事件。
 */
export async function orchestrateRun(
  deps: RunDeps,
  input: RunOrchestrationInput,
): Promise<RunOrchestrationResult> {
  const budget = input.budget ?? DEFAULT_RUN_BUDGET;
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const workspaceSource = await deps.loadWorkspaceSource({
    runId: input.runId,
    resumeId: input.resumeId,
    userId: input.userId,
  });
  let workspace = createWorkspace(workspaceSource);

  let emitted = 0;
  const emit = async (draft: BusinessEventDraft) => {
    await deps.emitEvent(draft);
    emitted += 1;
  };

  await emit({ type: "attempt.started", payload: { attemptId: input.attemptId } });

  const adapterState = { startedTools: new Set<string>() };
  const tools: Array<{ toolName: string; status: ToolExecutionResult["status"] }> = [];
  let sawError: { code: string; message: string } | null = null;
  let committed = false;
  let lastReceipt: { mutationId: string; revision: number } | null = null;
  let sawEndEvent = false;
  /**
   * 是否收到 SDK 的 `finish` 片段。
   *
   * 契约要求「attempt 结束事件缺失的 EOF 必须 interrupted」。流**正常走完**必然有
   * `finish`；没有它就意味着 provider 提前关闭了连接 —— 此时绝不能判成 completed，
   * 否则 UI 会对一次被截断的执行显示「已完成」。
   */
  let sawFinish = false;
  /**
   * 是否因超出时间预算而主动停止。
   *
   * 与 `sawError` 分开：超预算是**我们自己决定停下**，属于「中断」；
   * 把它记成 failed 会让用户看到「执行失败」，而实际是「时间不够，可以继续」。
   */
  let deadlineExceeded = false;
  /**
   * 流中途出现过的结束事件类型。
   *
   * 必须**记住事实**而不是在收尾时重新推断：例如 askUser 已经发出
   * `run.waiting_user`，若收尾时按 `shouldWaitForUser()` 重新判断，
   * 就会把这个已发生的事实覆盖成 `completed`。
   */
  let observedEndType: RunEventType | null = null;
  /**
   * 是否应停止继续消费流。
   *
   * 用于「进入等待用户」这一情形：等待意味着本轮到此为止，后续片段
   * （尤其是写工具调用）都不应再被执行。
   */
  let shouldStopConsuming = false;

  const streamAdapterOptions: StreamAdapterOptions = {
    isCancelled: () => deps.isCancelled() || input.abortSignal.aborted,
    shouldWaitForUser: () => deps.shouldWaitForUser(),
  };

  const deadline = startedAt + budget.deadlineMs;

  try {
    const stream = deps.streamModel({
      system: deps.buildSystemPrompt({ writeMode: input.writeMode }),
      messages: deps.buildMessages({ workspace, history: input.history ?? [] }),
      tools: deps.buildTools({ writeMode: input.writeMode }),
      abortSignal: input.abortSignal,
      maxSteps: budget.maxSteps,
    });

    for await (const part of stream) {
      // 预算耗尽：明确中断，不假装完成。
      if (now() > deadline) {
        // 超预算：停止，但记为「中断」而非「失败」（用户仍可继续）。
        deadlineExceeded = true;
        break;
      }

      // 工具调用需要编排层参与（适配器不执行工具）。
      if (part.type === "tool-call") {
        const toolCallId = String((part as { toolCallId?: unknown }).toolCallId ?? "");
        const toolName = String((part as { toolName?: unknown }).toolName ?? "");
        const args = (part as { input?: unknown }).input;

        // 先让适配器发出「参数完整」事件。
        for (const draft of adaptStreamPart(part, adapterState)) {
          await emit(draft);
        }

        if (!toolCallId || !toolName) continue;

        /*
         * 提交前 fencing 核验。
         *
         * 取消与提交可能并发；只有在**真正执行工具之前**再核验一次，
         * 才能让「取消先成功则禁止提交」成立。核验失败时不执行工具，
         * 并如实记为一个被中断的工具结果（不写成 completed）。
         */
        const writable = await deps.isWritable();
        if (!writable) {
          const failed: ToolExecutionResult = {
            status: "failed",
            code: "run_not_writable",
            message: "本次执行已取消或被接管，未执行该工具",
          };
          tools.push({ toolName, status: "failed" });
          await emit({
            type: "tool.failed",
            payload: { toolCallId, toolName, code: failed.code },
          });
          continue;
        }

        const outcome = await deps.executeTool({
          toolCallId,
          toolName,
          args,
          workspace,
          writeMode: input.writeMode,
          fence:
            typeof input.fenceToken === "number"
              ? { runId: input.runId, fenceToken: input.fenceToken }
              : null,
        });
        tools.push({ toolName, status: outcome.status });

        switch (outcome.status) {
          case "succeeded": {
            /*
             * 工具声称改了文档时，必须有**真实回执**（mutationId + revision）。
             * 没有回执就说明没有落盘 —— 这里不把它计入 committed，
             * 也不向事件流报告「已提交」。
             */
            if (outcome.mutationId && typeof outcome.revision === "number") {
              committed = true;
              lastReceipt = { mutationId: outcome.mutationId, revision: outcome.revision };
              await emit({
                type: "mutation.committed",
                payload: {
                  mutationId: outcome.mutationId,
                  revision: outcome.revision,
                  changeSetId: outcome.changeSetId ?? null,
                },
              });
              // 只有拿到回执后才把修改提升为工作副本基准。
              workspace = {
                ...workspace,
                base: workspace.current,
                revision: outcome.revision,
                changes: [],
              };
            }
            await emit({
              type: "tool.succeeded",
              payload: {
                toolCallId,
                toolName,
                result: outcome.result,
                mutationId: outcome.mutationId,
                changeSetId: outcome.changeSetId,
              },
            });
            break;
          }
          case "failed": {
            await emit({
              type: "tool.failed",
              payload: { toolCallId, toolName, code: outcome.code, message: outcome.message },
            });
            break;
          }
          case "proposed": {
            await emit({
              type: "proposal.ready",
              payload: {
                changeSetId: outcome.changeSetId,
                proposalVersion: outcome.proposalVersion,
                summary: outcome.summary,
                operationCount: outcome.operations.length,
              },
            });
            await emit({
              type: "tool.succeeded",
              payload: { toolCallId, toolName, result: { status: "proposed" }, changeSetId: outcome.changeSetId },
            });
            break;
          }
          case "asked": {
            // 用共享的单一断言保证「一个 attempt 只能有一个结束结果」。
            assertSingleAttemptEnd(observedEndType, "run.waiting_user");
            await emit({
              type: "run.waiting_user",
              payload: { question: outcome.question },
            });
            sawEndEvent = true;
            observedEndType = "run.waiting_user";
            /*
             * 必须**跳出整个流的消费**，而不是只跳出 switch。
             *
             * 进入「等待用户」后继续消费同一个流，会把模型在 askUser 之后发起的
             * 写工具也执行掉 —— 用户还没回答，文档已经被改（实测可复现）。
             * 这里用外层标记在循环末尾终止消费，保证等待之后不再有任何写入。
             */
            shouldStopConsuming = true;
            break;
          }
        }
        continue;
      }

      if (part.type === "finish") sawFinish = true;

      // 已进入等待用户：停止消费，不再执行后续任何工具调用。
      if (shouldStopConsuming) break;

      // 其余片段交给适配器；若它给出了结束类事件，记录「已结束」。
      for (const draft of adaptStreamPart(part, adapterState)) {
        await emit(draft);
        if (isAttemptEndDraft(draft)) {
          sawEndEvent = true;
          observedEndType = draft.type;
        }
        if (draft.type === "run.failed") {
          sawError = {
            code: String(draft.payload.code ?? "unknown_error"),
            message: String(draft.payload.message ?? "模型调用失败"),
          };
        }
      }
    }
  } catch (error) {
    // 连接/模型异常：如实记录，由 finalizeAttempt 决定结论。
    sawError = {
      code: error instanceof Error ? error.name : "stream_error",
      message: error instanceof Error ? error.message : "流式调用失败",
    };
  }

  /*
   * 收尾：一个 attempt **只能有一个**结束事件。
   *
   * 若流里已经给出过结束类事件（例如 askUser 的 waiting_user），就不再补第二个。
   * 否则由 finalizeAttempt 统一判定，判据顺序：取消 > 错误 > 等待用户 > 完成。
   */
  if (!sawEndEvent) {
    /*
     * 收尾判定。三种「没有显式结束事件」的情形必须区分开：
     *
     * - **超预算**：我们自己停下 → interrupted（不是失败，用户仍可继续）；
     * - **取消/错误**：已有确定结论 → finalizeAttempt（取消优先于错误）；
     * - **没有 `finish` 的正常退出**：流被 provider 截断（平台超时杀请求等）
     *   → interrupted，绝不因为「没有更多片段了」就推断完成。
     *
     * 注意：`events.ts` 的 `resolveEofOutcome` 回答的是**另一个问题**
     * （「EOF 该不该把已持久化的 Run 记为 interrupted」，供恢复路径使用），
     * 与这里「本次 attempt 最终该发哪种结束事件」不是同一件事 ——
     * 因此这里不调用它，避免制造一个只为覆盖率存在的假调用点。
     */
    const closing = deadlineExceeded
      ? finalizeOnInterrupt({ ...streamAdapterOptions, sawError })
      : sawFinish || sawError !== null || (deps.isCancelled?.() ?? false) || input.abortSignal.aborted
        ? finalizeAttempt({ ...streamAdapterOptions, sawError })
        : finalizeOnInterrupt({ ...streamAdapterOptions, sawError });
    await emit(closing);
    sawEndEvent = true;
    return {
      endType: closing.type,
      emitted,
      committed,
      lastReceipt,
      tools,
    };
  }

  /*
   * 已结束：**沿用实际发出过的结束事件类型**，不重新推断。
   *
   * 重新推断会丢掉已发生的事实（例如 askUser 已经发出 waiting_user，
   * 却因为 `shouldWaitForUser()` 返回 false 被改成 completed）。
   * 但**取消**是例外：用户点了取消，即使流里已经出现过 completed 的迹象，
   * 结论也必须是 cancelled —— 否则「点了取消却显示完成」。
   */
  const cancelled = (deps.isCancelled?.() ?? false) || input.abortSignal.aborted;

  /*
   * 已发生过结束事件、但随后又被取消：必须**补发**一条 cancelled 事件。
   *
   * 此前的实现把 endType 覆写成 run.cancelled 却不再发事件，于是服务端若按
   * endType 落库、客户端按事件投影，两端会对同一 attempt 得出不同结论
   * （服务端 cancelled / 客户端 waiting_user）。返回值与事件流必须同源。
   *
   * 注意这不是「第二个结束事件」—— 取消改变了结论本身，事件流里应当能看到它。
   */
  if (cancelled && observedEndType !== null && observedEndType !== "run.cancelled") {
    await emit({ type: "run.cancelled", payload: { reason: "用户取消（此前已进入等待）" } });
    return { endType: "run.cancelled", emitted, committed, lastReceipt, tools };
  }

  const endType: RunEventType = cancelled
    ? "run.cancelled"
    : (observedEndType ?? "run.interrupted");

  return { endType, emitted, committed, lastReceipt, tools };
}

/**
 * 判断一次工具结果是否**真的**改动了文档。
 *
 * 用途：UI 与日志据此区分「模型说改了」与「确实落盘了」。
 * 这是规格 F04 的机械防线 —— 旧实现把「生成了操作」当成「已应用」。
 */
export function toolTouchedDocument(outcome: ToolExecutionResult): boolean {
  return (
    outcome.status === "succeeded" &&
    typeof outcome.mutationId === "string" &&
    typeof outcome.revision === "number"
  );
}

/** 目标内容是否与基准一致（用于「零变更不生成空修订」的前置判断）。 */
export function workspaceHasChanges(workspace: WorkspaceSnapshot): boolean {
  return workspace.changes.length > 0;
}

export type { ResumeContent };
