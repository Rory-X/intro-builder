"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { EventType, type BaseEvent } from "@ag-ui/core";
import {
  HttpAgent,
  type HttpAgentFetchFn,
  type RunAgentResult,
} from "@ag-ui/client";
import {
  useAgUiRuntime,
  type UseAgUiRuntimeOptions,
} from "@assistant-ui/react-ag-ui";
import { AssistantRuntimeProvider as AssistantUiRuntimeProvider } from "@assistant-ui/react";

import {
  extractAgUiContextStatus,
  extractAgUiResumeWorkspace,
  extractAgUiResumeToolResult,
  extractAgUiQuestion,
  readAgUiSseStream,
  type AgUiContextStatus,
  type AgUiResumeWorkspace,
  type AgUiResumeToolResult,
  type AgUiAgentQuestion,
} from "@/lib/agent/ag-ui-stream";
import { isAutoApplicableOperation } from "@/lib/agent/apply-operation";
import { fetchDirectAgentRunStream } from "@/lib/agent/direct-run-client";
import type {
  AgentResumeContext,
  AgentResumeSessionMode,
  AgentWorkflowId,
  ResumeOperation,
} from "@intro-builder/shared/types";

type AgentRunIntent = {
  mode: AgentResumeSessionMode;
  workflowId: AgentWorkflowId | null;
};

type IntroBuilderForwardedProps =
  | {
      resumeId: string;
      mode?: "optimize_existing";
      locale: "zh-CN";
      workflowId: AgentWorkflowId | null;
      context: AgentResumeContext;
      threadId?: string;
    }
  | {
      resumeId: null;
      mode: "create_from_zero";
      locale: "zh-CN";
      workflowId: "create-from-zero";
      context: null;
    };

type RunParameters = Parameters<HttpAgent["runAgent"]>[0];
type RunSubscriber = Parameters<HttpAgent["runAgent"]>[1];

export type AgentAgUiRuntimeProviderProps = {
  children: ReactNode;
  getIntroBuilderForwardedProps: (
    intent: AgentRunIntent,
  ) => IntroBuilderForwardedProps;
  onRunStart: (messages: readonly { role?: unknown }[]) => void;
  onTextDelta: () => void;
  onRunSettled: () => void;
  onError: (message: string) => void;
  onContextStatus: (status: AgUiContextStatus) => void;
  onResumeWorkspace: (workspace: AgUiResumeWorkspace) => void;
  onToolResult: (result: AgUiResumeToolResult) => void;
  onInterrupts: (interrupts: AgentAgUiInterrupt[]) => void;
  autoAccept?: boolean;
  onOperationApplied?: (operation: ResumeOperation) => void;
  onQuestion?: (question: AgUiAgentQuestion) => void;
};

export type AgentAgUiInterrupt = {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  responseSchema?: Record<string, unknown>;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

type AgentAgUiResumeEntry = {
  interruptId: string;
  status: "resolved" | "cancelled";
  payload?: unknown;
};

type AgentRuntimeMessageLike = {
  role?: unknown;
  content?: unknown;
};

type AgentAgUiInterruptSubmit = (
  responses: readonly AgentAgUiResumeEntry[],
) => Promise<void>;

const AgentAgUiInterruptContext = createContext<AgentAgUiInterruptSubmit | null>(
  null,
);

export function useAgentAgUiInterruptSubmit() {
  return useContext(AgentAgUiInterruptContext);
}

export function AgentAgUiRuntimeProvider({
  children,
  getIntroBuilderForwardedProps,
  onRunStart,
  onTextDelta,
  onRunSettled,
  onError,
  onContextStatus,
  onResumeWorkspace,
  onToolResult,
  onInterrupts,
  autoAccept = false,
  onOperationApplied,
  onQuestion,
}: AgentAgUiRuntimeProviderProps) {
  const agent = useMemo(
    () =>
      new IntroBuilderHttpAgent({
        url: "/api/agent/direct-runs",
        getIntroBuilderForwardedProps,
        onRunStart,
        onTextDelta,
        onRunSettled,
        onError,
        onContextStatus,
        onResumeWorkspace,
        onToolResult,
        onInterrupts,
        autoAccept,
        onOperationApplied,
        onQuestion,
      }),
    [
      getIntroBuilderForwardedProps,
      onRunStart,
      onTextDelta,
      onRunSettled,
      onError,
      onContextStatus,
      onResumeWorkspace,
      onToolResult,
      onInterrupts,
      autoAccept,
      onOperationApplied,
      onQuestion,
    ],
  );
  const runtime = useAgUiRuntime({
    agent: agent as unknown as UseAgUiRuntimeOptions["agent"],
    showThinking: true,
    onError: (error) => {
      if (isAbortError(error)) return;
      onError(readUserFacingAgentError(error.message || "Agent 服务暂不可用"));
    },
  });
  const submitInterruptResponses = useCallback<AgentAgUiInterruptSubmit>(
    async (responses) => {
      await runtime.unstable_submitInterruptResponses(responses);
    },
    [runtime],
  );

  return (
    <AgentAgUiInterruptContext.Provider value={submitInterruptResponses}>
      <AssistantUiRuntimeProvider runtime={runtime}>
        {children}
      </AssistantUiRuntimeProvider>
    </AgentAgUiInterruptContext.Provider>
  );
}

class IntroBuilderHttpAgent extends HttpAgent {
  private readonly getIntroBuilderForwardedProps: (
    intent: AgentRunIntent,
  ) => IntroBuilderForwardedProps;
  private readonly onRunStart: (messages: readonly { role?: unknown }[]) => void;
  private readonly onRunSettled: () => void;

  constructor({
    url,
    getIntroBuilderForwardedProps,
    onRunStart,
    onTextDelta,
    onRunSettled,
    onError,
    onContextStatus,
    onResumeWorkspace,
    onToolResult,
    onInterrupts,
    autoAccept = false,
    onOperationApplied,
    onQuestion,
  }: {
    url: string;
    getIntroBuilderForwardedProps: (
      intent: AgentRunIntent,
    ) => IntroBuilderForwardedProps;
    onRunStart: (messages: readonly { role?: unknown }[]) => void;
    onTextDelta: () => void;
    onRunSettled: () => void;
    onError: (message: string) => void;
    onContextStatus: (status: AgUiContextStatus) => void;
    onResumeWorkspace: (workspace: AgUiResumeWorkspace) => void;
    onToolResult: (result: AgUiResumeToolResult) => void;
    onInterrupts: (interrupts: AgentAgUiInterrupt[]) => void;
    autoAccept?: boolean;
    onOperationApplied?: (operation: ResumeOperation) => void;
    onQuestion?: (question: AgUiAgentQuestion) => void;
  }) {
    const observeFetch: HttpAgentFetchFn = async (requestUrl, requestInit) => {
      const response = await fetchDirectAgentRunStream({
        requestUrl,
        requestInit,
      }).catch((error) => {
        if (isAbortError(error)) {
          return buildCancelledRunResponse(requestInit.body);
        }
        throw error;
      });
      void observeAgUiResponse(response.clone(), {
        onTextDelta,
        onError,
        onContextStatus,
        onResumeWorkspace,
        onToolResult,
        onInterrupts,
        autoAccept,
        onOperationApplied,
        onQuestion,
      });
      return response;
    };
    super({ url, fetch: observeFetch });

    this.getIntroBuilderForwardedProps = getIntroBuilderForwardedProps;
    this.onRunStart = onRunStart;
    this.onRunSettled = onRunSettled;
  }

  override async runAgent(
    parameters?: RunParameters,
    subscriber?: RunSubscriber,
    options?: { signal?: AbortSignal },
  ): Promise<RunAgentResult> {
    const forwardedProps = readForwardedProps(parameters?.forwardedProps);
    const messages = (this.messages ?? []) as readonly AgentRuntimeMessageLike[];
    const intent = readForwardedAgentRunIntent(forwardedProps, messages);
    const abortController = new AbortController();
    const abortSignal = options?.signal;

    if (abortSignal?.aborted) {
      abortController.abort(abortSignal.reason);
    } else {
      abortSignal?.addEventListener(
        "abort",
        () => abortController.abort(abortSignal.reason),
        { once: true },
      );
    }

    this.onRunStart(this.messages ?? []);
    try {
      return await super.runAgent(
        {
          ...parameters,
          abortController,
          forwardedProps: {
            ...forwardedProps,
            introBuilder: this.getIntroBuilderForwardedProps(intent),
          },
        },
        subscriber,
      );
    } catch (error) {
      if (isAbortError(error)) {
        return { result: null, newMessages: [] };
      }
      throw error;
    } finally {
      this.onRunSettled();
    }
  }
}

async function observeAgUiResponse(
  response: Response,
  {
    onTextDelta,
    onError,
    onContextStatus,
    onResumeWorkspace,
    onToolResult,
    onInterrupts,
    autoAccept = false,
    onOperationApplied,
    onQuestion,
  }: {
    onTextDelta: () => void;
    onError: (message: string) => void;
    onContextStatus: (status: AgUiContextStatus) => void;
    onResumeWorkspace: (workspace: AgUiResumeWorkspace) => void;
    onToolResult: (result: AgUiResumeToolResult) => void;
    onInterrupts: (interrupts: AgentAgUiInterrupt[]) => void;
    autoAccept?: boolean;
    onOperationApplied?: (operation: ResumeOperation) => void;
    onQuestion?: (question: AgUiAgentQuestion) => void;
  },
) {
  if (!response.ok) {
    onError(readAgentError(await readErrorBody(response)));
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return;

  try {
    for await (const event of readAgUiSseStream(response)) {
      if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        onTextDelta();
      }
      if (event.type === EventType.RUN_ERROR) {
        onError(readRunErrorEvent(event));
      }
      const contextStatus = extractAgUiContextStatus(event);
      if (contextStatus) {
        onContextStatus(contextStatus);
      }
      const resumeWorkspace = extractAgUiResumeWorkspace(event);
      if (resumeWorkspace) {
        onResumeWorkspace(resumeWorkspace);
      }
      const interrupts = extractAgUiInterrupts(event);
      if (interrupts.length > 0) {
        onInterrupts(interrupts);
      }

      const toolResult = extractAgUiResumeToolResult(event);
      if (toolResult) {
        onToolResult(toolResult);
        if (autoAccept && onOperationApplied && toolResult.proposedOperations) {
          for (const operation of toolResult.proposedOperations) {
            if (!isAutoApplicableOperation(operation)) continue;
            onOperationApplied(operation);
          }
        }
      }

      const question = extractAgUiQuestion(event);
      if (question && onQuestion) {
        onQuestion(question);
      }
    }
  } catch (error) {
    if (isAbortError(error)) return;
    onError(
      readUserFacingAgentError(
        error instanceof Error ? error.message : "Agent 服务暂不可用",
      ),
    );
  }
}

function isAbortError(value: unknown): boolean {
  if (value instanceof Error) {
    return value.name === "AbortError" || value.message === "Aborted";
  }
  if (!isRecord(value)) return false;
  return value.name === "AbortError" || value.message === "Aborted";
}

function buildCancelledRunResponse(body: BodyInit | null | undefined): Response {
  const runIdentity = readRunIdentity(body);
  const events = [
    {
      type: EventType.RUN_STARTED,
      threadId: runIdentity.threadId,
      runId: runIdentity.runId,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: runIdentity.threadId,
      runId: runIdentity.runId,
    },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function readRunIdentity(body: BodyInit | null | undefined): {
  threadId: string;
  runId: string;
} {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (isRecord(parsed)) {
        return {
          threadId: readNonEmptyString(parsed.threadId) ?? "cancelled",
          runId: readNonEmptyString(parsed.runId) ?? "cancelled",
        };
      }
    } catch {
      return { threadId: "cancelled", runId: "cancelled" };
    }
  }
  return { threadId: "cancelled", runId: "cancelled" };
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
    readNonEmptyString(value.id) !== null &&
    readNonEmptyString(value.reason) !== null &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.toolCallId === undefined || typeof value.toolCallId === "string") &&
    (value.responseSchema === undefined || isRecord(value.responseSchema)) &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string") &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
}

function readForwardedProps(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readForwardedAgentRunIntent(
  forwardedProps: Record<string, unknown>,
  messages: readonly AgentRuntimeMessageLike[] = [],
): AgentRunIntent {
  const runConfig = isRecord(forwardedProps.runConfig)
    ? forwardedProps.runConfig
    : null;
  const custom = isRecord(runConfig?.custom) ? runConfig.custom : null;
  const introBuilder = isRecord(forwardedProps.introBuilder)
    ? forwardedProps.introBuilder
    : null;
  const explicitMode =
    readAgentResumeSessionMode(custom?.mode) ??
    readAgentResumeSessionMode(runConfig?.mode) ??
    readAgentResumeSessionMode(forwardedProps.mode) ??
    readAgentResumeSessionMode(introBuilder?.mode);
  const mode =
    explicitMode ??
    (isFreeFormCreateFromZeroRequest(messages) ? "create_from_zero" : null) ??
    "optimize_existing";
  const workflowId =
    readWorkflowId(custom?.workflowId) ??
    readWorkflowId(runConfig?.workflowId) ??
    readWorkflowId(forwardedProps.workflowId) ??
    readWorkflowId(introBuilder?.workflowId) ??
    (mode === "create_from_zero" ? "create-from-zero" : null);

  return { mode, workflowId };
}

function isFreeFormCreateFromZeroRequest(
  messages: readonly AgentRuntimeMessageLike[],
): boolean {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const text = readRuntimeMessageText(lastUserMessage?.content).replace(/\s+/g, "");
  if (!text) return false;
  return /(?:从(?:0|零)|从头|重新|新建|创建|生成|起草|写|做).{0,16}简历|简历.{0,16}(?:从(?:0|零)|从头|重新|新建|创建|生成|起草|写|做)/.test(
    text,
  );
}

function readRuntimeMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function readWorkflowId(value: unknown): AgentWorkflowId | null {
  if (
    value === "resume-diagnose" ||
    value === "target-role-match" ||
    value === "experience-star" ||
    value === "pre-export-check" ||
    value === "create-from-zero"
  ) {
    return value;
  }
  return null;
}

function readAgentResumeSessionMode(value: unknown): AgentResumeSessionMode | null {
  if (value === "optimize_existing" || value === "create_from_zero") return value;
  return null;
}

function readRunErrorEvent(event: BaseEvent): string {
  const body = event as {
    message?: unknown;
    code?: unknown;
    requestId?: unknown;
  };
  return readAgentError({
    error: body.message,
    code: body.code,
    requestId: body.requestId,
  });
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readAgentError(value: unknown): string {
  if (isRecord(value)) {
    const retryAfterSeconds =
      typeof value.retryAfterSeconds === "number" ? value.retryAfterSeconds : null;
    if (retryAfterSeconds) {
      return `Agent 服务暂不可用，${retryAfterSeconds} 秒后可重试`;
    }
    return readUserFacingAgentError(
      readNonEmptyString(value.error) ?? "Agent 服务暂不可用",
    );
  }
  return "Agent 服务暂不可用";
}

function readUserFacingAgentError(message: string): string {
  if (message.includes("HTTP ") || message.includes("requestId")) {
    return "Agent 服务暂不可用";
  }
  if (message.includes("dependency_unavailable")) {
    return "Agent 服务暂不可用";
  }
  if (containsInternalAgentDetail(message)) {
    return "Agent 服务暂不可用";
  }
  return message || "Agent 服务暂不可用";
}

function containsInternalAgentDetail(message: string): boolean {
  return (
    /\b(?:draftResume|contextStatus|effectiveInputBudgetTokens|modelInputLimitTokens|workspace|fieldPath|toolCall|resumeId|sessionSnapshot|profileSummary)\b/.test(
      message,
    ) ||
    /\b[a-z][a-zA-Z0-9_]*(?:\.[a-z][a-zA-Z0-9_]*)+\b/.test(message) ||
    /\bis required\b/.test(message)
  );
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
