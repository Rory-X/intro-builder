"use client";

import { useRef, useState, type ReactNode } from "react";
import * as React from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessage,
  type ToolCallMessagePartProps,
  useAuiState,
  useEditComposer,
  useThreadRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowLeft,
  CheckCircle2,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Edit3,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import { AgentConfirmationCard } from "@/components/agent/agent-confirmation-card";
import {
  AgentAgUiRuntimeProvider,
  useAgentAgUiInterruptSubmit,
  type AgentAgUiInterrupt,
} from "@/components/agent/agent-ag-ui-runtime-provider";
import { AgentToolCard } from "@/components/agent/agent-tool-card";
import { Button } from "@/components/ui/button";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type {
  AgentMessageResponse,
  AgentResumeContext,
  AgentWorkflowId,
  ResumeOperation,
} from "@intro-builder/shared/types";
import type { ResumeContent } from "@intro-builder/shared/schemas";

type AgentRetryRequest = {
  content: string;
  workflowId: AgentWorkflowId | null;
};

type AgentTurnStatus =
  | "reading"
  | "generating"
  | "waiting-confirmation"
  | "awaiting-input"
  | "applied"
  | "complete";

type AgentTurnArtifacts = {
  id: string;
  assistantOrdinal: number;
  status: AgentTurnStatus;
  toolCalls: AgentMessageResponse["toolCalls"];
  operations: ResumeOperation[];
  interrupts: AgentAgUiInterrupt[];
  appliedOperationIds: string[];
};

const AGENT_WELCOME_SUGGESTIONS = [
  {
    label: "帮我找最值得改的一处",
    prompt: "帮我找出这份简历里最值得优先修改的一处，并说明原因。",
  },
  {
    label: "按 STAR 优化最近经历",
    prompt: "请按 STAR 原则检查最近一段经历，告诉我需要补充哪些事实。",
  },
  {
    label: "检查导出前风险",
    prompt: "请做一次导出前终检，指出格式、内容和可信度风险。",
  },
] as const;

export function AgentPanel({
  resumeId,
  title,
  templateId,
  getResumeContent,
  completeness,
  applyOperation,
  flushAutosave,
  onBackToEdit,
}: {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
  onBackToEdit: () => void;
}) {
  const [turnArtifacts, setTurnArtifacts] = useState<AgentTurnArtifacts[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRetryRequest, setLastRetryRequest] = useState<AgentRetryRequest | null>(
    null,
  );
  const activeTurnIdRef = useRef<string | null>(null);

  function beginAgentTurn(messages: readonly { role?: unknown }[]) {
    const turnId = createTurnId();
    activeTurnIdRef.current = turnId;
    setTurnArtifacts((current) => [
      ...current,
      {
        id: turnId,
        assistantOrdinal: countAssistantMessages(messages),
        status: "reading",
        toolCalls: [],
        operations: [],
        interrupts: [],
        appliedOperationIds: [],
      },
    ]);
    return turnId;
  }

  function updateAgentTurn(
    turnId: string | null,
    update: (turn: AgentTurnArtifacts) => AgentTurnArtifacts,
  ) {
    if (!turnId) return;
    setTurnArtifacts((current) =>
      current.map((turn) => (turn.id === turnId ? update(turn) : turn)),
    );
  }

  function setAgentTurnStatus(turnId: string | null, status: AgentTurnStatus) {
    updateAgentTurn(turnId, (turn) => ({
      ...turn,
      status:
        turn.status === "waiting-confirmation" ||
        turn.status === "awaiting-input" ||
        turn.status === "applied"
          ? turn.status
          : status,
    }));
  }

  function appendToolResult(
    toolResult: {
      toolCall: AgentMessageResponse["toolCalls"][number];
      proposedOperations: ResumeOperation[];
    },
    turnId = activeTurnIdRef.current,
  ) {
    updateAgentTurn(turnId, (turn) => ({
      ...turn,
      toolCalls: [...turn.toolCalls, toolResult.toolCall],
      operations: [...turn.operations, ...toolResult.proposedOperations],
      status:
        toolResult.proposedOperations.length > 0
          ? "waiting-confirmation"
          : "complete",
    }));
  }

  function setAgentTurnInterrupts(
    nextInterrupts: AgentAgUiInterrupt[],
    turnId = activeTurnIdRef.current,
  ) {
    const questionInterrupts = getQuestionInterrupts(nextInterrupts);
    updateAgentTurn(turnId, (turn) => ({
      ...turn,
      interrupts: nextInterrupts,
      status:
        questionInterrupts.length > 0
          ? "awaiting-input"
          : turn.status === "awaiting-input"
            ? "complete"
            : turn.status,
    }));
  }

  function settleAgentTurn(turnId: string | null) {
    updateAgentTurn(turnId, (turn) => {
      if (
        turn.status === "waiting-confirmation" ||
        turn.status === "awaiting-input" ||
        turn.status === "applied"
      ) {
        return turn;
      }
      if (turn.operations.length > 0) {
        return { ...turn, status: "waiting-confirmation" };
      }
      if (getQuestionInterrupts(turn.interrupts).length > 0) {
        return { ...turn, status: "awaiting-input" };
      }
      return { ...turn, status: "complete" };
    });
  }

  function markOperationApplied(turnId: string, operationId: string) {
    updateAgentTurn(turnId, (turn) => {
      const appliedOperationIds = turn.appliedOperationIds.includes(operationId)
        ? turn.appliedOperationIds
        : [...turn.appliedOperationIds, operationId];
      const allOperationsApplied =
        turn.operations.length > 0 &&
        turn.operations.every((operation) =>
          appliedOperationIds.includes(operation.id),
        );

      return {
        ...turn,
        appliedOperationIds,
        status: allOperationsApplied ? "applied" : "waiting-confirmation",
      };
    });
  }

  return (
    <section
      data-agent-runtime-mode="ag-ui"
      className="flex h-full min-h-[480px] flex-col bg-background"
    >
      <AgentAgUiRuntimeProvider
        getIntroBuilderForwardedProps={(workflowId) => ({
          resumeId,
          locale: "zh-CN",
          workflowId,
          context: buildAgentResumeContext({
            content: getResumeContent(),
            templateId,
            activeSection: null,
            completeness,
          }),
        })}
        onRunStart={(messages) => {
          setError(null);
          beginAgentTurn(messages);
          setIsLoading(true);
          // Capture last message for retry
          const lastMessage = messages[messages.length - 1] as
            | { role?: string; content?: string | Array<{ type?: string; text?: string }> }
            | undefined;
          if (lastMessage?.role === "user") {
            const content =
              typeof lastMessage.content === "string"
                ? lastMessage.content
                : Array.isArray(lastMessage.content)
                  ? lastMessage.content.find((c) => c.type === "text")?.text || ""
                  : "";
            if (content) {
              setLastRetryRequest({ content, workflowId: null });
            }
          }
        }}
        onTextDelta={() => {
          setAgentTurnStatus(activeTurnIdRef.current, "generating");
        }}
        onRunSettled={() => {
          settleAgentTurn(activeTurnIdRef.current);
          setIsLoading(false);
        }}
        onError={(message) => {
          setError(message);
        }}
        onToolResult={appendToolResult}
        onInterrupts={setAgentTurnInterrupts}
      >
        <div className="border-b p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Agent 模式</p>
              <h2 className="mt-1 font-semibold">简历 Agent</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                AI 会读取当前表单快照，修改需你确认。
              </p>
              <p className="mt-2 text-xs text-muted-foreground">当前目标：{title}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onBackToEdit}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              切回编辑
            </Button>
          </div>
        </div>

        <AgentThreadArea
          turnArtifacts={turnArtifacts}
          error={error}
          lastRetryRequest={lastRetryRequest}
          isLoading={isLoading}
          onDismissError={() => {
            setError(null);
          }}
          onRetryStarted={() => {
            setError(null);
          }}
          onInterruptResolved={(turnId) => setAgentTurnInterrupts([], turnId)}
          onOperationApplied={markOperationApplied}
          applyOperation={applyOperation}
          flushAutosave={flushAutosave}
        />
        <AgentComposer title={title} isLoading={isLoading} />
      </AgentAgUiRuntimeProvider>
    </section>
  );
}

function AgentThreadArea({
  turnArtifacts,
  error,
  lastRetryRequest,
  isLoading,
  onDismissError,
  onRetryStarted,
  onInterruptResolved,
  onOperationApplied,
  applyOperation,
  flushAutosave,
}: {
  turnArtifacts: AgentTurnArtifacts[];
  error: string | null;
  lastRetryRequest: AgentRetryRequest | null;
  isLoading: boolean;
  onDismissError: () => void;
  onRetryStarted: () => void;
  onInterruptResolved: (turnId: string) => void;
  onOperationApplied: (turnId: string, operationId: string) => void;
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
}) {
  const threadMessages = useAuiState((state) => state.thread.messages);
  const { artifactByAssistantMessageId, pendingArtifacts } =
    buildTurnArtifactRenderState(threadMessages, turnArtifacts);
  const isEmpty =
    threadMessages.length === 0 && !turnArtifacts.some(hasVisibleTurnArtifacts);

  return (
    <ThreadPrimitive.Root className="min-h-0 flex-1">
      <ThreadPrimitive.Viewport
        data-testid="agent-assistant-ui-thread"
        className="h-full space-y-3 overflow-y-auto p-4"
        autoScroll
      >
        {isEmpty ? (
          <AgentWelcomeSuggestions />
        ) : null}
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <AgentThreadMessage
              message={message}
              turnArtifact={
                message.role === "assistant"
                  ? artifactByAssistantMessageId.get(message.id) ?? null
                  : null
              }
              onInterruptResolved={onInterruptResolved}
              onOperationApplied={onOperationApplied}
              applyOperation={applyOperation}
              flushAutosave={flushAutosave}
            />
          )}
        </ThreadPrimitive.Messages>
        {pendingArtifacts.map((turnArtifact) => (
          <AgentTurnArtifactsPanel
            key={turnArtifact.id}
            turnArtifact={turnArtifact}
            onInterruptResolved={onInterruptResolved}
            onOperationApplied={onOperationApplied}
            applyOperation={applyOperation}
            flushAutosave={flushAutosave}
          />
        ))}
        {error ? (
          <AgentErrorCard
            error={error}
            retryRequest={lastRetryRequest}
            isLoading={isLoading}
            onDismiss={onDismissError}
            onRetryStarted={onRetryStarted}
          />
        ) : null}
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 flex justify-center py-2">
          <ThreadPrimitive.ScrollToBottom
            aria-label="滚动到底部"
            behavior="smooth"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-sky-200/80 bg-background/95 px-3 text-xs font-medium text-sky-800 shadow-sm backdrop-blur hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-0 dark:border-sky-400/20 dark:bg-background/85 dark:text-sky-200 dark:hover:bg-sky-950/40"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            滚动到底部
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function AgentWelcomeSuggestions() {
  return (
    <div className="rounded-2xl border border-dashed border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-background p-4 text-sm shadow-sm dark:border-sky-400/20 dark:from-sky-950/30">
      <div className="flex gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">从这些问题开始</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Agent 会先解释它读取了什么、准备做什么；所有简历修改都要你确认后才写入。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AGENT_WELCOME_SUGGESTIONS.map((suggestion) => (
              <ThreadPrimitive.Suggestion
                key={suggestion.label}
                prompt={suggestion.prompt}
                send
                className="rounded-full border border-sky-200/80 bg-background px-3 py-1.5 text-xs font-medium text-sky-800 shadow-sm transition hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-50 dark:border-sky-400/20 dark:bg-background/60 dark:text-sky-200 dark:hover:bg-sky-950/40"
              >
                {suggestion.label}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentErrorCard({
  error,
  retryRequest,
  isLoading,
  onDismiss,
  onRetryStarted,
}: {
  error: string;
  retryRequest: AgentRetryRequest | null;
  isLoading: boolean;
  onDismiss: () => void;
  onRetryStarted: () => void;
}) {
  const threadRuntime = useThreadRuntime();

  function retryLastRequest() {
    if (!retryRequest || isLoading) return;

    onRetryStarted();
    threadRuntime.append({
      role: "user",
      content: [{ type: "text", text: retryRequest.content }],
      runConfig: retryRequest.workflowId
        ? { custom: { workflowId: retryRequest.workflowId } }
        : undefined,
    });
  }

  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Agent 服务暂时没有完成这次请求</p>
          <p className="mt-1 break-words text-xs text-destructive/90">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            已保留当前简历内容和对话；你可以重试上一条，或稍后继续输入。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭错误提示"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {retryRequest ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isLoading}
            onClick={retryLastRequest}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            重新发送上一条
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AgentTurnArtifactsPanel({
  turnArtifact,
  onInterruptResolved,
  onOperationApplied,
  applyOperation,
  flushAutosave,
}: {
  turnArtifact: AgentTurnArtifacts;
  onInterruptResolved: (turnId: string) => void;
  onOperationApplied: (turnId: string, operationId: string) => void;
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
}) {
  const submitInterrupts = useAgentAgUiInterruptSubmit();
  const [decisions, setDecisions] = React.useState<Map<string, boolean>>(new Map());
  const approvalInterrupts = getApprovalInterrupts(turnArtifact.interrupts);
  const questionInterrupts = getQuestionInterrupts(turnArtifact.interrupts);

  if (!hasVisibleTurnArtifacts(turnArtifact)) {
    return null;
  }

  const hasApprovalInterrupts = approvalInterrupts.length > 0;

  async function handleApplyOperation(operation: ResumeOperation) {
    applyOperation(operation);
    onOperationApplied(turnArtifact.id, operation.id);
    flushAutosave();

    if (!hasApprovalInterrupts) return;

    const newDecisions = new Map(decisions);
    newDecisions.set(getApprovalInterruptDecisionId(approvalInterrupts, operation), true);
    setDecisions(newDecisions);

    // Submit all decisions once all interrupts have been decided
    if (approvalInterrupts.every((interrupt) => newDecisions.has(interrupt.id))) {
      await submitAllDecisions(newDecisions);
    }
  }

  async function handleRejectOperation(operationId: string) {
    if (!hasApprovalInterrupts) return;

    const newDecisions = new Map(decisions);
    newDecisions.set(operationId, false);
    setDecisions(newDecisions);

    // Submit all decisions once all interrupts have been decided
    if (approvalInterrupts.every((interrupt) => newDecisions.has(interrupt.id))) {
      await submitAllDecisions(newDecisions);
    }
  }

  async function submitAllDecisions(allDecisions: Map<string, boolean>) {
    if (!submitInterrupts || !hasApprovalInterrupts) return;

    try {
      const responses = approvalInterrupts.map((interrupt) => ({
        interruptId: interrupt.id,
        status: allDecisions.get(interrupt.id) ? ("resolved" as const) : ("cancelled" as const),
        payload: { approved: allDecisions.get(interrupt.id) || false },
      }));
      await submitInterrupts(responses);
      onInterruptResolved(turnArtifact.id);
    } catch (error) {
      console.error("[agent-panel] Failed to submit decisions:", error);
    }
  }

  async function handleApplyAll() {
    for (const operation of turnArtifact.operations) {
      applyOperation(operation);
      onOperationApplied(turnArtifact.id, operation.id);
    }
    flushAutosave();

    if (!hasApprovalInterrupts) return;

    const allApproved = new Map(
      approvalInterrupts.map((interrupt) => [interrupt.id, true])
    );
    setDecisions(allApproved);
    await submitAllDecisions(allApproved);
  }

  async function handleRejectAll() {
    if (!hasApprovalInterrupts) return;

    const allRejected = new Map(
      approvalInterrupts.map((interrupt) => [interrupt.id, false])
    );
    setDecisions(allRejected);
    await submitAllDecisions(allRejected);
  }

  return (
    <div
      data-testid="agent-turn-artifacts"
      data-agent-turn-status={turnArtifact.status}
      className="max-w-[85%] space-y-2 pl-1 text-left"
    >
      <AgentTurnStatusLine turnArtifact={turnArtifact} />
      {turnArtifact.toolCalls.length > 0 ? (
        <div className="space-y-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
          <div className="text-xs font-medium text-muted-foreground">
            已完成 {turnArtifact.toolCalls.length} 个工具调用
          </div>
          {turnArtifact.toolCalls.map((toolCall) => (
            <AgentToolCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      ) : null}
      {questionInterrupts.length > 0 ? (
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
          <AgentQuestionCard
            interrupts={questionInterrupts}
            onResolved={() => onInterruptResolved(turnArtifact.id)}
          />
        </div>
      ) : null}
      {turnArtifact.operations.length > 0 ? (
        <div className="space-y-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {turnArtifact.status === "applied"
                ? `已应用 ${turnArtifact.operations.length} 条修改`
                : `等待确认 ${countPendingOperations(turnArtifact)} 条修改建议`}
            </div>
            {turnArtifact.status === "waiting-confirmation" &&
            turnArtifact.operations.length > 1 ? (
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleApplyAll}
                  className="h-6 px-2 text-xs"
                >
                  全部应用
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleRejectAll}
                  className="h-6 px-2 text-xs"
                >
                  全部拒绝
                </Button>
              </div>
            ) : null}
          </div>
          {turnArtifact.operations.map((operation) => (
            <AgentConfirmationCard
              key={operation.id}
              operation={operation}
              onApply={handleApplyOperation}
              onReject={handleRejectOperation}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentTurnStatusLine({
  turnArtifact,
}: {
  turnArtifact: AgentTurnArtifacts;
}) {
  const statusText = getAgentTurnStatusText(turnArtifact);
  const isRunning =
    turnArtifact.status === "reading" || turnArtifact.status === "generating";
  const Icon =
    turnArtifact.status === "applied"
      ? CheckCircle2
      : turnArtifact.status === "waiting-confirmation" ||
          turnArtifact.status === "awaiting-input"
        ? Clock3
        : Loader2;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={isRunning ? "agent-loading-indicator" : "agent-turn-status-line"}
      className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-background/40 dark:text-sky-200"
    >
      <Icon className={isRunning ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
      <span className={isRunning ? "animate-pulse" : undefined}>{statusText}</span>
    </div>
  );
}

function AgentQuestionCard({
  interrupts,
  onResolved,
}: {
  interrupts: AgentAgUiInterrupt[];
  onResolved: () => void;
}) {
  const submitInterrupts = useAgentAgUiInterruptSubmit();
  const threadRuntime = useThreadRuntime();
  const [answer, setAnswer] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const primaryInterrupt = interrupts[0];
  if (!primaryInterrupt) return null;

  async function submitAnswer() {
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer || isSubmitting) return;

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      if (submitInterrupts) {
        await submitInterrupts(
          interrupts.map((interrupt) => ({
            interruptId: interrupt.id,
            status: "resolved",
            payload: { answer: trimmedAnswer },
          })),
        );
      } else {
        await threadRuntime.append({
          role: "user",
          content: [{ type: "text", text: `补充信息：${trimmedAnswer}` }],
        });
      }
      onResolved();
      setAnswer("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交补充信息失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-sky-200/80 bg-sky-50/80 p-3 text-sm shadow-sm dark:border-sky-400/20 dark:bg-sky-950/30">
      <div className="flex gap-2">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Agent 需要补充信息</p>
          <p className="mt-1 text-muted-foreground">
            {primaryInterrupt.message ?? "请补充一个关键信息，Agent 会继续当前任务。"}
          </p>
          <div className="mt-3 space-y-2">
            <label
              htmlFor="agent-question-answer"
              className="block text-xs font-medium text-muted-foreground"
            >
              补充信息
            </label>
            <textarea
              id="agent-question-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="例如：增长型前端工程师，偏数据看板和投放平台"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                只会作为本轮 Agent 上下文，不会直接写入简历。
              </p>
              <Button
                type="button"
                size="sm"
                disabled={answer.trim() === "" || isSubmitting}
                onClick={submitAnswer}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                继续分析
              </Button>
            </div>
            {submitError ? (
              <p className="text-xs text-destructive">{submitError}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentThreadMessage({
  message,
  turnArtifact,
  onInterruptResolved,
  onOperationApplied,
  applyOperation,
  flushAutosave,
}: {
  message: ThreadMessage;
  turnArtifact: AgentTurnArtifacts | null;
  onInterruptResolved: (turnId: string) => void;
  onOperationApplied: (turnId: string, operationId: string) => void;
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
}) {
  const text = readThreadMessageText(message);
  if (message.role === "system") return null;

  if (message.role === "assistant") {
    const hasRunningToolCall = hasRunningAssistantToolCall(message);
    if (!text && !hasRunningToolCall && !turnArtifact) return null;

    return (
      <>
        {text || hasRunningToolCall ? (
          <MessagePrimitive.Root className="group/message text-left">
            <div className="inline-block max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
              <MessagePrimitive.Content
                components={{
                  Text: AgentMarkdownText,
                  ToolGroup: hasRunningToolCall
                    ? AgentAssistantUiToolGroup
                    : AgentAssistantUiHiddenToolGroup,
                  tools: {
                    Override: hasRunningToolCall
                      ? AgentAssistantUiToolPart
                      : AgentAssistantUiHiddenToolPart,
                  },
                }}
              />
            </div>
            <AgentAssistantMessageActions />
          </MessagePrimitive.Root>
        ) : null}
        {turnArtifact ? (
          <AgentTurnArtifactsPanel
            turnArtifact={turnArtifact}
            onInterruptResolved={onInterruptResolved}
            onOperationApplied={onOperationApplied}
            applyOperation={applyOperation}
            flushAutosave={flushAutosave}
          />
        ) : null}
      </>
    );
  }

  if (!text) return null;

  return (
    <MessagePrimitive.Root className="group/message text-right">
      <AgentUserMessageBody text={text} />
    </MessagePrimitive.Root>
  );
}

function AgentUserMessageBody({ text }: { text: string }) {
  const isEditing = useEditComposer((state) => state.isEditing);

  if (isEditing) {
    return <AgentEditMessageComposer />;
  }

  return (
    <>
      <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-xl bg-sky-600 px-3 py-2 text-sm text-white shadow-sm dark:bg-sky-500">
        {text}
      </div>
      <AgentUserMessageActions />
    </>
  );
}

function AgentEditMessageComposer() {
  return (
    <ComposerPrimitive.Root className="ml-auto max-w-[85%] rounded-xl border border-sky-200/80 bg-background p-2 text-left shadow-sm dark:border-sky-400/20">
      <ComposerPrimitive.Input
        data-testid="agent-edit-message-input"
        rows={2}
        submitMode="ctrlEnter"
        className="min-h-16 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <ComposerPrimitive.Cancel
          aria-label="取消编辑"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground shadow-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
        >
          <X className="h-3.5 w-3.5" />
          取消
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send
          aria-label="保存并重新发送"
          className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-600 px-2 text-xs font-medium text-white shadow-sm hover:bg-sky-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
        >
          <Check className="h-3.5 w-3.5" />
          保存并重新发送
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

function AgentAssistantMessageActions() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="mt-1 flex max-w-[85%] gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy
        aria-label="复制回答"
        copiedDuration={1600}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[copied=true]:border-emerald-200 data-[copied=true]:text-emerald-700 dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:data-[copied=true]:text-emerald-300"
      >
        <Copy className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload
        aria-label="重新生成回答"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function AgentUserMessageActions() {
  return (
    <ActionBarPrimitive.Root
      autohide="never"
      autohideFloat="never"
      className="ml-auto mt-1 flex max-w-[85%] justify-end gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy
        aria-label="复制消息"
        copiedDuration={1600}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[copied=true]:border-emerald-200 data-[copied=true]:text-emerald-700 dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:data-[copied=true]:text-emerald-300"
      >
        <Copy className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Edit
        aria-label="编辑消息"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
      >
        <Edit3 className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
}

function AgentAssistantUiHiddenToolGroup() {
  return null;
}

function AgentAssistantUiToolGroup({ children }: { children?: ReactNode }) {
  return (
    <div className="my-2 rounded-xl border border-sky-200/80 bg-sky-50/80 p-2 shadow-sm dark:border-sky-400/20 dark:bg-sky-950/30">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-sky-800 dark:text-sky-200">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Agent 正在使用工具
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function AgentAssistantUiHiddenToolPart() {
  return null;
}

function AgentAssistantUiToolPart({
  toolName,
  result,
  status,
}: ToolCallMessagePartProps) {
  if (result !== undefined) return null;

  const isWaitingForAction = status.type === "requires-action";

  return (
    <div
      role="status"
      aria-live="polite"
      className="my-1 rounded-lg border border-sky-200/80 bg-sky-50 px-3 py-2 text-xs text-sky-800 shadow-sm dark:border-sky-400/20 dark:bg-sky-950/30 dark:text-sky-200"
    >
      <div className="flex items-center gap-2">
        {isWaitingForAction ? (
          <Clock3 className="h-3.5 w-3.5" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        <span className="font-medium">
          {isWaitingForAction
            ? `等待工具继续 ${toolName}`
            : `正在执行工具 ${toolName}`}
        </span>
      </div>
      <p className="mt-1 text-sky-700/80 dark:text-sky-200/80">
        工具结果会先展示给你；涉及简历修改时，确认前不会写入表单。
      </p>
    </div>
  );
}

function AgentMarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="space-y-2 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
      smooth
    />
  );
}

function AgentComposer({ title, isLoading }: { title: string; isLoading: boolean }) {
  return (
    <ComposerPrimitive.Root className="border-t p-4">
      <div className="flex gap-2">
        <ComposerPrimitive.Input
          data-testid="agent-assistant-ui-composer-input"
          rows={1}
          submitMode="enter"
          placeholder={`问问 ${title || "这份简历"} 可以怎么优化`}
          className="min-h-9 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isLoading ? (
          <ComposerPrimitive.Cancel
            aria-label="停止生成"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sky-200/80 bg-sky-50 text-sky-800 shadow hover:bg-sky-100 disabled:pointer-events-none disabled:opacity-50 dark:border-sky-400/20 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span className="sr-only">停止生成</span>
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send
            aria-label="发送"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            <span className="sr-only">发送</span>
          </ComposerPrimitive.Send>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
}

function buildTurnArtifactRenderState(
  messages: readonly { id: string; role?: unknown }[],
  turnArtifacts: AgentTurnArtifacts[],
) {
  const assistantMessageIds = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.id);
  const artifactByAssistantMessageId = new Map<string, AgentTurnArtifacts>();
  const pendingArtifacts: AgentTurnArtifacts[] = [];

  for (const turnArtifact of turnArtifacts) {
    if (!hasVisibleTurnArtifacts(turnArtifact)) continue;
    const assistantMessageId = assistantMessageIds[turnArtifact.assistantOrdinal];
    if (assistantMessageId) {
      artifactByAssistantMessageId.set(assistantMessageId, turnArtifact);
    } else {
      pendingArtifacts.push(turnArtifact);
    }
  }

  return { artifactByAssistantMessageId, pendingArtifacts };
}

function hasVisibleTurnArtifacts(turnArtifact: AgentTurnArtifacts) {
  return (
    turnArtifact.status !== "complete" ||
    turnArtifact.toolCalls.length > 0 ||
    turnArtifact.operations.length > 0 ||
    turnArtifact.interrupts.length > 0
  );
}

function getAgentTurnStatusText(turnArtifact: AgentTurnArtifacts) {
  if (turnArtifact.status === "applied") return "已应用";
  if (getQuestionInterrupts(turnArtifact.interrupts).length > 0) {
    return "等待补充信息";
  }
  if (countPendingOperations(turnArtifact) > 0) return "等待确认修改";
  if (turnArtifact.status === "reading") {
    return "AI 正在思考：正在读取简历上下文";
  }
  if (turnArtifact.status === "generating") return "正在生成修改建议";
  if (turnArtifact.toolCalls.length > 0) return "已完成工具调用";
  return "已完成";
}

function countPendingOperations(turnArtifact: AgentTurnArtifacts) {
  return turnArtifact.operations.filter(
    (operation) => !turnArtifact.appliedOperationIds.includes(operation.id),
  ).length;
}

function countAssistantMessages(messages: readonly { role?: unknown }[]) {
  return messages.filter((message) => message.role === "assistant").length;
}

function createTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `turn_${crypto.randomUUID()}`;
  }
  return `turn_${Math.random().toString(36).slice(2)}`;
}

function readThreadMessageText(message: ThreadMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function hasRunningAssistantToolCall(message: ThreadMessage): boolean {
  return message.content.some(
    (part) => part.type === "tool-call" && part.result === undefined,
  );
}

function getQuestionInterrupts(interrupts: AgentAgUiInterrupt[]) {
  return interrupts.filter((interrupt) => interrupt.reason !== "approval_required");
}

function getApprovalInterrupts(interrupts: AgentAgUiInterrupt[]) {
  return interrupts.filter((interrupt) => interrupt.reason === "approval_required");
}

function getApprovalInterruptDecisionId(
  approvalInterrupts: AgentAgUiInterrupt[],
  operation: ResumeOperation,
) {
  return (
    approvalInterrupts.find((interrupt) => interrupt.id === operation.id)?.id ??
    approvalInterrupts.find((interrupt) => interrupt.toolCallId === operation.toolCallId)
      ?.id ??
    operation.id
  );
}
