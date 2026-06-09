"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  type ChatModelRunOptions,
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
import { AgentPresetWorkflows } from "@/components/agent/agent-preset-workflows";
import {
  AgentRuntimeProvider,
  type AgentRuntimeProviderProps,
} from "@/components/agent/agent-runtime-provider";
import { AgentToolCard } from "@/components/agent/agent-tool-card";
import { Button } from "@/components/ui/button";
import {
  extractAgUiResumeToolResult,
  readAgUiSseStream,
} from "@/lib/agent/ag-ui-stream";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type {
  AgentChatMessage,
  AgentMessageResponse,
  AgentResumeContext,
  AgentWorkflowId,
  ResumeOperation,
} from "@/lib/agent/agent-message-contract";
import type { ResumeContent } from "@/lib/resume-schema";

export type AgentRuntimeMode = "local" | "ag-ui";

type AgentRetryRequest = {
  content: string;
  workflowId: AgentWorkflowId | null;
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
  runtimeMode,
}: {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
  onBackToEdit: () => void;
  runtimeMode?: AgentRuntimeMode;
}) {
  const [toolCalls, setToolCalls] = useState<AgentMessageResponse["toolCalls"]>([]);
  const [operations, setOperations] = useState<ResumeOperation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAwaitingAssistant, setIsAwaitingAssistant] = useState(false);
  const [interrupts, setInterrupts] = useState<AgentAgUiInterrupt[]>([]);
  const [lastRetryRequest, setLastRetryRequest] = useState<AgentRetryRequest | null>(
    null,
  );
  const resolvedRuntimeMode = resolveAgentRuntimeMode(runtimeMode);

  function appendToolResult(toolResult: {
    toolCall: AgentMessageResponse["toolCalls"][number];
    proposedOperations: ResumeOperation[];
  }) {
    setToolCalls((current) => [...current, toolResult.toolCall]);
    setOperations((current) => [...current, ...toolResult.proposedOperations]);
  }

  async function* sendRuntimeMessage(
    content: string,
    {
      abortSignal,
      messages,
      runConfig,
    }: {
      abortSignal: AbortSignal;
      messages: readonly ThreadMessage[];
      runConfig: ChatModelRunOptions["runConfig"];
    },
  ): AsyncGenerator<string> {
    const trimmedContent = content.trim();
    if (!trimmedContent || isLoading || abortSignal.aborted) return;
    const workflowId = readWorkflowId(runConfig);

    setLastRetryRequest({ content: trimmedContent, workflowId });
    setError(null);
    setIsLoading(true);
    setIsAwaitingAssistant(true);

    try {
      const response = await fetch("/api/agent/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(buildAgUiRunInput({
          resumeId,
          workflowId,
          messages,
          content: getResumeContent(),
          templateId,
          completeness,
        })),
        signal: abortSignal,
      });
      if (!response.ok) {
        throw new Error(readAgentError(await readErrorBody(response)));
      }

      let assistantText = "";
      for await (const event of readAgUiSseStream(response)) {
        if (abortSignal.aborted) return;

        const delta = readTextDelta(event);
        if (delta !== null) {
          assistantText += delta;
          if (assistantText.trim() !== "") {
            setIsAwaitingAssistant(false);
          }
          yield assistantText;
          continue;
        }

        const toolResult = extractAgUiResumeToolResult(event);
        if (toolResult) {
          appendToolResult(toolResult);
        }

        const nextInterrupts = extractAgUiInterrupts(event);
        if (nextInterrupts.length > 0) {
          setInterrupts(nextInterrupts);
        }
      }
    } catch (sendError) {
      if (abortSignal.aborted || isAbortError(sendError)) return;
      setError(sendError instanceof Error ? sendError.message : "Agent 服务暂不可用");
    } finally {
      setIsAwaitingAssistant(false);
      setIsLoading(false);
    }
  }

  return (
    <section
      data-agent-runtime-mode={resolvedRuntimeMode}
      className="flex h-full min-h-[480px] flex-col bg-background"
    >
      <AgentRuntimeBoundary
        mode={resolvedRuntimeMode}
        sendMessage={sendRuntimeMessage}
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
        onRunStart={() => {
          setError(null);
          setInterrupts([]);
          setIsLoading(true);
          setIsAwaitingAssistant(true);
        }}
        onTextDelta={() => {
          setIsAwaitingAssistant(false);
        }}
        onRunSettled={() => {
          setIsAwaitingAssistant(false);
          setIsLoading(false);
        }}
        onError={(message) => {
          setError(message);
        }}
        onToolResult={appendToolResult}
        onInterrupts={setInterrupts}
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
          <div className="mt-4">
            <AgentWorkflowControls
              disabled={isLoading}
              onWorkflowStart={(request) => {
                setLastRetryRequest(request);
              }}
            />
          </div>
        </div>

        <AgentThreadArea
          toolCalls={toolCalls}
          operations={operations}
          error={error}
          lastRetryRequest={lastRetryRequest}
          isLoading={isLoading}
          isAwaitingAssistant={isAwaitingAssistant}
          interrupts={interrupts}
          onDismissError={() => {
            setError(null);
          }}
          onRetryStarted={() => {
            setError(null);
            setInterrupts([]);
          }}
          onInterruptResolved={() => {
            setInterrupts([]);
          }}
          applyOperation={applyOperation}
          flushAutosave={flushAutosave}
        />
        <AgentComposer title={title} isLoading={isLoading} />
      </AgentRuntimeBoundary>
    </section>
  );
}

function AgentRuntimeBoundary({
  mode,
  sendMessage,
  getIntroBuilderForwardedProps,
  onRunStart,
  onTextDelta,
  onRunSettled,
  onError,
  onToolResult,
  onInterrupts,
  children,
}: {
  mode: AgentRuntimeMode;
  sendMessage: AgentRuntimeProviderProps["sendMessage"];
  getIntroBuilderForwardedProps: ComponentProps<
    typeof AgentAgUiRuntimeProvider
  >["getIntroBuilderForwardedProps"];
  onRunStart: () => void;
  onTextDelta: () => void;
  onRunSettled: () => void;
  onError: (message: string) => void;
  onToolResult: ComponentProps<typeof AgentAgUiRuntimeProvider>["onToolResult"];
  onInterrupts: ComponentProps<typeof AgentAgUiRuntimeProvider>["onInterrupts"];
  children: ReactNode;
}) {
  if (mode === "ag-ui") {
    return (
      <AgentAgUiRuntimeProvider
        getIntroBuilderForwardedProps={getIntroBuilderForwardedProps}
        onRunStart={onRunStart}
        onTextDelta={onTextDelta}
        onRunSettled={onRunSettled}
        onError={onError}
        onToolResult={onToolResult}
        onInterrupts={onInterrupts}
      >
        {children}
      </AgentAgUiRuntimeProvider>
    );
  }

  return (
    <AgentRuntimeProvider sendMessage={sendMessage}>
      {children}
    </AgentRuntimeProvider>
  );
}

function buildAgUiRunInput({
  resumeId,
  workflowId,
  messages,
  content,
  templateId,
  completeness,
}: {
  resumeId: string;
  workflowId: AgentWorkflowId | null;
  messages: readonly ThreadMessage[];
  content: ResumeContent;
  templateId: string;
  completeness: AgentResumeContext["completeness"];
}): RunAgentInput {
  return {
    threadId: resumeId,
    runId: createRunId(),
    state: null,
    messages: toAgentChatMessages(messages),
    tools: [],
    context: [],
    forwardedProps: {
      introBuilder: {
        resumeId,
        locale: "zh-CN",
        workflowId,
        context: buildAgentResumeContext({
          content,
          templateId,
          activeSection: null,
          completeness,
        }),
      },
    },
  };
}

function AgentWorkflowControls({
  disabled,
  onWorkflowStart,
}: {
  disabled: boolean;
  onWorkflowStart: (request: AgentRetryRequest) => void;
}) {
  const threadRuntime = useThreadRuntime();

  return (
    <AgentPresetWorkflows
      disabled={disabled}
      onStart={(workflow) => {
        onWorkflowStart({ content: workflow.prompt, workflowId: workflow.id });
        threadRuntime.append({
          role: "user",
          content: [{ type: "text", text: workflow.prompt }],
          runConfig: { custom: { workflowId: workflow.id } },
        });
      }}
    />
  );
}

function AgentThreadArea({
  toolCalls,
  operations,
  error,
  lastRetryRequest,
  isLoading,
  isAwaitingAssistant,
  interrupts,
  onDismissError,
  onRetryStarted,
  onInterruptResolved,
  applyOperation,
  flushAutosave,
}: {
  toolCalls: AgentMessageResponse["toolCalls"];
  operations: ResumeOperation[];
  error: string | null;
  lastRetryRequest: AgentRetryRequest | null;
  isLoading: boolean;
  isAwaitingAssistant: boolean;
  interrupts: AgentAgUiInterrupt[];
  onDismissError: () => void;
  onRetryStarted: () => void;
  onInterruptResolved: () => void;
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
}) {
  const messageCount = useAuiState((state) => state.thread.messages.length);
  const isEmpty =
    messageCount === 0 &&
    toolCalls.length === 0 &&
    operations.length === 0 &&
    interrupts.length === 0;

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
        <AgentActivityTimeline
          isAwaitingAssistant={isAwaitingAssistant}
          toolCalls={toolCalls}
          operations={operations}
          interrupts={interrupts}
        />
        {interrupts.length > 0 ? (
          <AgentQuestionCard
            interrupts={interrupts}
            onResolved={onInterruptResolved}
          />
        ) : null}
        <ThreadPrimitive.Messages>
          {({ message }) => <AgentThreadMessage message={message} />}
        </ThreadPrimitive.Messages>
        {isAwaitingAssistant ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="agent-loading-indicator"
            className="inline-flex max-w-[85%] items-center gap-2 rounded-xl border border-sky-200/70 bg-sky-50 px-3 py-2 text-sm text-sky-800 shadow-sm dark:border-sky-400/20 dark:bg-sky-950/30 dark:text-sky-200"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            AI 正在思考，回答会流式展开…
          </div>
        ) : null}
        {toolCalls.map((toolCall) => (
          <AgentToolCard key={toolCall.id} toolCall={toolCall} />
        ))}
        {operations.map((operation) => (
          <AgentConfirmationCard
            key={operation.id}
            operation={operation}
            onApply={(nextOperation) => {
              applyOperation(nextOperation);
              flushAutosave();
            }}
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

function AgentActivityTimeline({
  isAwaitingAssistant,
  toolCalls,
  operations,
  interrupts,
}: {
  isAwaitingAssistant: boolean;
  toolCalls: AgentMessageResponse["toolCalls"];
  operations: ResumeOperation[];
  interrupts: AgentAgUiInterrupt[];
}) {
  if (
    !isAwaitingAssistant &&
    toolCalls.length === 0 &&
    operations.length === 0 &&
    interrupts.length === 0
  ) {
    return null;
  }

  const latestToolCall = toolCalls.at(-1);

  return (
    <div
      data-testid="agent-activity-timeline"
      className="rounded-xl border border-sky-200/70 bg-gradient-to-br from-sky-50 to-background p-3 text-sm shadow-sm dark:border-sky-400/20 dark:from-sky-950/30"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">Agent 活动</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每一步都先展示给你，确认前不会写入简历。
          </p>
        </div>
        {operations.length > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            待确认
          </span>
        ) : interrupts.length > 0 ? (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
            等待补充
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {isAwaitingAssistant ? (
          <AgentActivityItem
            status="running"
            title="正在读取简历上下文"
            description="Agent 正在读取当前表单快照，并规划下一步。"
          />
        ) : null}
        {toolCalls.length > 0 ? (
          <AgentActivityItem
            status="complete"
            title={`已完成 ${toolCalls.length} 个工具调用`}
            description={
              latestToolCall
                ? `最近完成：${latestToolCall.title}`
                : "工具调用已完成。"
            }
          />
        ) : null}
        {operations.length > 0 ? (
          <AgentActivityItem
            status="waiting"
            title={`等待确认 ${operations.length} 条修改建议`}
            description="应用前不会改动表单；点击应用后会触发自动保存。"
          />
        ) : null}
        {interrupts.length > 0 ? (
          <AgentActivityItem
            status="question"
            title={`等待回答 ${interrupts.length} 个问题`}
            description="补充关键信息后，Agent 会接着这轮任务继续分析。"
          />
        ) : null}
      </div>
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

function AgentActivityItem({
  status,
  title,
  description,
}: {
  status: "running" | "complete" | "waiting" | "question";
  title: string;
  description: string;
}) {
  const Icon =
    status === "running"
      ? Loader2
      : status === "complete"
        ? CheckCircle2
        : status === "question"
          ? MessageCircleQuestion
          : Clock3;

  return (
    <div className="flex gap-2 rounded-lg bg-background/80 p-2 dark:bg-background/50">
      <span
        className={
          status === "running"
            ? "mt-0.5 text-sky-600 dark:text-sky-300"
            : status === "complete"
              ? "mt-0.5 text-emerald-600 dark:text-emerald-300"
              : status === "question"
                ? "mt-0.5 text-sky-600 dark:text-sky-300"
                : "mt-0.5 text-amber-600 dark:text-amber-300"
        }
      >
        <Icon className={status === "running" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      </span>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function AgentThreadMessage({ message }: { message: ThreadMessage }) {
  const text = readThreadMessageText(message);
  if (message.role === "system") return null;

  if (message.role === "assistant") {
    if (!text && !hasRunningAssistantToolCall(message)) return null;

    return (
      <MessagePrimitive.Root className="group/message text-left">
        <div className="inline-block max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
          <MessagePrimitive.Content
            components={{
              Text: AgentMarkdownText,
              ToolGroup: AgentAssistantUiToolGroup,
              tools: { Override: AgentAssistantUiToolPart },
            }}
          />
        </div>
        <AgentAssistantMessageActions />
      </MessagePrimitive.Root>
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

function createRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `run_${crypto.randomUUID()}`;
  }
  return `run_${Math.random().toString(36).slice(2)}`;
}

function toAgentChatMessages(messages: readonly ThreadMessage[]): AgentChatMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const content = readThreadMessageText(message);
    if (!content) return [];
    return [{ id: message.id, role: message.role, content }];
  });
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

function readWorkflowId(runConfig: ChatModelRunOptions["runConfig"]): AgentWorkflowId | null {
  const workflowId = runConfig.custom?.workflowId;
  if (isAgentWorkflowId(workflowId)) return workflowId;
  return null;
}

function isAgentWorkflowId(value: unknown): value is AgentWorkflowId {
  return (
    value === "resume-diagnose" ||
    value === "target-role-match" ||
    value === "experience-star" ||
    value === "pre-export-check"
  );
}

function readAgentError(value: unknown): string {
  if (value && typeof value === "object") {
    const body = value as {
      error?: unknown;
      code?: unknown;
      requestId?: unknown;
      retryAfterSeconds?: unknown;
    };
    const error = readNonEmptyString(body.error) ?? "Agent 服务暂不可用";
    const code = readNonEmptyString(body.code);
    const requestId = readNonEmptyString(body.requestId);
    const retryAfterSeconds =
      typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null;
    const diagnostics = [
      code ? `code: ${code}` : null,
      requestId ? `requestId: ${requestId}` : null,
      retryAfterSeconds ? `${retryAfterSeconds} 秒后可重试` : null,
    ].filter(Boolean);

    if (diagnostics.length > 0) {
      return `${error}（${diagnostics.join("，")}）`;
    }
    return error;
  }
  return "Agent 服务暂不可用";
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readTextDelta(event: BaseEvent): string | null {
  if (event.type !== EventType.TEXT_MESSAGE_CONTENT) return null;
  const delta = event.delta;
  return typeof delta === "string" ? delta : null;
}

function isAbortError(value: unknown): boolean {
  return (
    value instanceof DOMException && value.name === "AbortError"
  ) || (
    value instanceof Error && value.name === "AbortError"
  );
}

function extractAgUiInterrupts(event: BaseEvent): AgentAgUiInterrupt[] {
  if (event.type !== EventType.RUN_FINISHED) return [];
  const outcome = (event as { outcome?: unknown }).outcome;
  if (!isRecord(outcome) || outcome.type !== "interrupt") return [];
  if (!Array.isArray(outcome.interrupts)) return [];

  return outcome.interrupts.filter(isAgentAgUiInterrupt);
}

function isAgentAgUiInterrupt(value: unknown): value is AgentAgUiInterrupt {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    typeof value.reason === "string" &&
    value.reason.trim() !== "" &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.toolCallId === undefined || typeof value.toolCallId === "string") &&
    (value.responseSchema === undefined || isRecord(value.responseSchema)) &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string") &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveAgentRuntimeMode(runtimeMode?: AgentRuntimeMode): AgentRuntimeMode {
  if (runtimeMode) return runtimeMode;
  return process.env.NEXT_PUBLIC_AGENT_RUNTIME === "ag-ui" ? "ag-ui" : "local";
}
