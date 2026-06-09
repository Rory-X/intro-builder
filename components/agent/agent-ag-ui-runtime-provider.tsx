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
  extractAgUiResumeToolResult,
  readAgUiSseStream,
  type AgUiResumeToolResult,
} from "@/lib/agent/ag-ui-stream";
import type {
  AgentResumeContext,
  AgentWorkflowId,
} from "@/lib/agent/agent-message-contract";

type IntroBuilderForwardedProps = {
  resumeId: string;
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  context: AgentResumeContext;
};

type RunParameters = Parameters<HttpAgent["runAgent"]>[0];
type RunSubscriber = Parameters<HttpAgent["runAgent"]>[1];

export type AgentAgUiRuntimeProviderProps = {
  children: ReactNode;
  getIntroBuilderForwardedProps: (
    workflowId: AgentWorkflowId | null,
  ) => IntroBuilderForwardedProps;
  onRunStart: () => void;
  onTextDelta: () => void;
  onRunSettled: () => void;
  onError: (message: string) => void;
  onToolResult: (result: AgUiResumeToolResult) => void;
  onInterrupts: (interrupts: AgentAgUiInterrupt[]) => void;
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
  onToolResult,
  onInterrupts,
}: AgentAgUiRuntimeProviderProps) {
  const agent = useMemo(
    () =>
      new IntroBuilderHttpAgent({
        url: "/api/agent/runs",
        getIntroBuilderForwardedProps,
        onRunStart,
        onTextDelta,
        onRunSettled,
        onError,
        onToolResult,
        onInterrupts,
      }),
    [
      getIntroBuilderForwardedProps,
      onRunStart,
      onTextDelta,
      onRunSettled,
      onError,
      onToolResult,
      onInterrupts,
    ],
  );
  const runtime = useAgUiRuntime({
    agent: agent as unknown as UseAgUiRuntimeOptions["agent"],
    showThinking: true,
    onError: (error) => {
      if (isAbortError(error)) return;
      onError(error.message || "Agent 服务暂不可用");
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
    workflowId: AgentWorkflowId | null,
  ) => IntroBuilderForwardedProps;
  private readonly onRunStart: () => void;
  private readonly onRunSettled: () => void;

  constructor({
    url,
    getIntroBuilderForwardedProps,
    onRunStart,
    onTextDelta,
    onRunSettled,
    onError,
    onToolResult,
    onInterrupts,
  }: {
    url: string;
    getIntroBuilderForwardedProps: (
      workflowId: AgentWorkflowId | null,
    ) => IntroBuilderForwardedProps;
    onRunStart: () => void;
    onTextDelta: () => void;
    onRunSettled: () => void;
    onError: (message: string) => void;
    onToolResult: (result: AgUiResumeToolResult) => void;
    onInterrupts: (interrupts: AgentAgUiInterrupt[]) => void;
  }) {
    const observeFetch: HttpAgentFetchFn = async (requestUrl, requestInit) => {
      const response = await fetch(requestUrl, requestInit).catch((error) => {
        if (isAbortError(error)) {
          return buildCancelledRunResponse(requestInit.body);
        }
        throw error;
      });
      void observeAgUiResponse(response.clone(), {
        onTextDelta,
        onError,
        onToolResult,
        onInterrupts,
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
    const workflowId = readForwardedWorkflowId(forwardedProps);
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

    this.onRunStart();
    try {
      return await super.runAgent(
        {
          ...parameters,
          abortController,
          forwardedProps: {
            ...forwardedProps,
            introBuilder: this.getIntroBuilderForwardedProps(workflowId),
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
    onToolResult,
    onInterrupts,
  }: {
    onTextDelta: () => void;
    onError: (message: string) => void;
    onToolResult: (result: AgUiResumeToolResult) => void;
    onInterrupts: (interrupts: AgentAgUiInterrupt[]) => void;
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
      const interrupts = extractAgUiInterrupts(event);
      if (interrupts.length > 0) {
        onInterrupts(interrupts);
      }

      const toolResult = extractAgUiResumeToolResult(event);
      if (toolResult) {
        onToolResult(toolResult);
      }
    }
  } catch (error) {
    if (isAbortError(error)) return;
    onError(error instanceof Error ? error.message : "Agent 服务暂不可用");
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

function readForwardedWorkflowId(
  forwardedProps: Record<string, unknown>,
): AgentWorkflowId | null {
  const runConfig = isRecord(forwardedProps.runConfig)
    ? forwardedProps.runConfig
    : null;
  const introBuilder = isRecord(forwardedProps.introBuilder)
    ? forwardedProps.introBuilder
    : null;

  return (
    readWorkflowId(runConfig?.workflowId) ??
    readWorkflowId(forwardedProps.workflowId) ??
    readWorkflowId(introBuilder?.workflowId)
  );
}

function readWorkflowId(value: unknown): AgentWorkflowId | null {
  if (
    value === "resume-diagnose" ||
    value === "target-role-match" ||
    value === "experience-star" ||
    value === "pre-export-check"
  ) {
    return value;
  }
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
    const error = readNonEmptyString(value.error) ?? "Agent 服务暂不可用";
    const code = readNonEmptyString(value.code);
    const requestId = readNonEmptyString(value.requestId);
    const retryAfterSeconds =
      typeof value.retryAfterSeconds === "number" ? value.retryAfterSeconds : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
