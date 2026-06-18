"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  SendHorizonal,
  Settings,
  Terminal,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type {
  AgentModelConfig,
  AgentResumeContext,
  AgentWorkflowId,
  ResumeOperation,
} from "@intro-builder/shared/types";
import type { ResumeContent } from "@intro-builder/shared/schemas";

type FloatingAgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: FloatingAgentMessagePart[];
  toolCalls?: FloatingAgentToolCall[];
};

type FloatingAgentMessagePart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "tool"; toolCall: FloatingAgentToolCall };

type FloatingAgentToolCall = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  summary: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type AgentModelSettingsForm = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

type FloatingModelOption = {
  id: string;
  label: string;
};

type FloatingChatSession = {
  id: string;
  title: string;
  updatedAt: string;
};

const MODEL_SETTINGS_STORAGE_KEY = "intro-builder.agent.model-settings.v1";
const MODEL_API_KEY_SESSION_STORAGE_KEY = "intro-builder.agent.model-api-key.v1";
const FLOATING_STREAM_ACCEPT_HEADER = "text/event-stream, application/json";

type FloatingAgentChatProps = {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
};

const MODEL_MISSING_MESSAGE = "__MODEL_CONFIG_MISSING__";

export function FloatingAgentChat({
  resumeId,
  title,
  templateId,
  getResumeContent,
  completeness,
  applyOperation,
  flushAutosave,
}: FloatingAgentChatProps) {
  const [messages, setMessages] = useState<FloatingAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<FloatingChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<AgentModelSettingsForm>(
    () => emptyModelSettings(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelConfig = useMemo(
    () => toAgentModelConfig(modelSettings),
    [modelSettings],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModelSettings(readStoredModelSettings());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/agent/floating/sessions/${sessionId}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("读取历史对话失败");
    const body = await response.json().catch(() => ({}));
    const loadedMessages = Array.isArray(body.messages)
      ? body.messages.map(toFloatingAgentMessage).filter(isFloatingAgentMessage)
      : [];
    setMessages(loadedMessages);
  }, []);

  const createNewSession = useCallback(async () => {
    const response = await fetch("/api/agent/floating/sessions", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resumeId }),
    });
    if (!response.ok) throw new Error("创建新对话失败");
    const body = await response.json().catch(() => ({}));
    const session = toFloatingChatSession(body.session);
    if (!session) throw new Error("创建新对话失败");
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    setActiveSessionId(session.id);
    setMessages([]);
    setInput("");
    setHistoryOpen(false);
    return session;
  }, [resumeId]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) {
        setHistoryOpen(false);
        return;
      }
      setActiveSessionId(sessionId);
      setHistoryOpen(false);
      try {
        await loadSessionMessages(sessionId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取历史对话失败");
      }
    },
    [activeSessionId, loadSessionMessages],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await fetch(`/api/agent/floating/sessions/${sessionId}`, {
          method: "DELETE",
          headers: { Accept: "application/json" },
        });
      } catch {
        toast.error("删除对话失败");
        return;
      }
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      if (sessionId !== activeSessionId) return;
      if (remaining.length > 0) {
        const nextSession = remaining[0];
        setActiveSessionId(nextSession.id);
        await loadSessionMessages(nextSession.id).catch(() => setMessages([]));
      } else {
        await createNewSession().catch(() => {
          setActiveSessionId(null);
          setMessages([]);
        });
      }
    },
    [activeSessionId, createNewSession, loadSessionMessages, sessions],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        const response = await fetch(
          `/api/agent/floating/sessions?resumeId=${encodeURIComponent(resumeId)}`,
          { headers: { Accept: "application/json" } },
        );
        const body = await response.json().catch(() => ({}));
        const loadedSessions = Array.isArray(body.sessions)
          ? body.sessions.map(toFloatingChatSession).filter(isFloatingChatSession)
          : [];
        if (cancelled) return;
        setSessions(loadedSessions);
        if (loadedSessions.length > 0) {
          const latest = loadedSessions[0];
          setActiveSessionId(latest.id);
          await loadSessionMessages(latest.id);
        } else if (response.ok) {
          await createNewSession();
        }
      } catch {
        if (!cancelled) {
          setActiveSessionId(null);
        }
      } finally {
        if (!cancelled) setSessionsLoaded(true);
      }
    }

    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [createNewSession, loadSessionMessages, resumeId]);

  const sendMessage = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const text = input.trim();
      if (!text || isLoading) return;

      const userMessage: FloatingAgentMessage = {
        id: createMessageId("user"),
        role: "user",
        content: text,
      };
      setMessages((current) => [...current, userMessage]);
      setInput("");

      if (!modelConfig) {
        setMessages((current) => [
          ...current,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            content: MODEL_MISSING_MESSAGE,
          },
        ]);
        return;
      }

      setIsLoading(true);
      const assistantMessageId = createMessageId("assistant");
      const appliedOperationIds = new Set<string>();
      const applyStreamOperations = (operations: ResumeOperation[]) => {
        const nextOperations = operations.filter((operation) => {
          if (appliedOperationIds.has(operation.id)) return false;
          appliedOperationIds.add(operation.id);
          return true;
        });
        for (const operation of nextOperations) {
          applyOperation(operation);
        }
        if (nextOperations.length > 0) {
          flushAutosave();
        }
      };
      try {
        const response = await fetch("/api/agent/floating/chat", {
          method: "POST",
          headers: {
            Accept: FLOATING_STREAM_ACCEPT_HEADER,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resumeId,
            locale: "zh-CN",
            workflowId: null satisfies AgentWorkflowId | null,
            sessionId: activeSessionId,
            messages: [...messages, userMessage].map((message) => ({
              role: message.role,
              content:
                message.content === MODEL_MISSING_MESSAGE ? "" : message.content,
            })),
            context: buildAgentResumeContext({
              content: getResumeContent(),
              templateId,
              activeSection: null,
              completeness,
            }),
            modelConfig,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            typeof body.error === "string" ? body.error : "AI 助手请求失败",
          );
        }

        let body: Record<string, unknown>;
        if (isEventStreamResponse(response)) {
          setMessages((current) => [
            ...current,
            {
              id: assistantMessageId,
              role: "assistant",
              content: "",
              parts: [],
              toolCalls: [],
            },
          ]);
          body = await readFloatingAgentStream(response, {
            onTextDelta: (delta) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: message.content + delta,
                        parts: appendFloatingTextPart(message.parts ?? [], delta),
                      }
                    : message,
                ),
              );
              scrollMessagesToBottom(scrollRef);
            },
            onToolCall: (toolCall) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        parts: upsertFloatingToolPart(
                          message.parts ?? [],
                          toolCall,
                        ),
                        toolCalls: mergeFloatingToolCalls(
                          message.toolCalls ?? [],
                          [toolCall],
                        ),
                      }
                    : message,
                ),
              );
              scrollMessagesToBottom(scrollRef);
            },
            onOperations: applyStreamOperations,
          });
        } else {
          body = await response.json().catch(() => ({}));
        }

        const operations = normalizeResumeOperations(body.operations).filter(
          (operation) => !appliedOperationIds.has(operation.id),
        );
        const toolCalls = normalizeToolCalls(body.toolCalls);
        const responseParts = normalizeFloatingMessageParts(body.parts);
        applyStreamOperations(operations);
        if (activeSessionId) {
          const nextTitle = text.slice(0, 50);
          setSessions((current) =>
            current.map((session) =>
              session.id === activeSessionId && session.title === "新对话"
                ? { ...session, title: nextTitle, updatedAt: new Date().toISOString() }
                : session,
            ),
          );
        }
        setMessages((current) => [
          ...(isEventStreamResponse(response)
            ? current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: finalAssistantMessage(body, operations),
                      parts:
                        responseParts ??
                        finalizeFloatingParts(
                          message.parts ?? [],
                          finalAssistantMessage(body, operations),
                          toolCalls,
                        ),
                      toolCalls: mergeFloatingToolCalls(
                        message.toolCalls ?? [],
                        toolCalls,
                      ),
                    }
                  : message,
              )
            : [
                ...current,
                {
                  id: assistantMessageId,
                  role: "assistant" as const,
                  content: finalAssistantMessage(body, operations),
                  parts:
                    responseParts ??
                    finalizeFloatingParts(
                      [],
                      finalAssistantMessage(body, operations),
                      toolCalls,
                    ),
                  toolCalls,
                },
              ]),
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AI 助手暂时不可用";
        toast.error(message);
        setMessages((current) => [
          ...current,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            content: `请求失败：${message}`,
          },
        ]);
      } finally {
        setIsLoading(false);
        scrollMessagesToBottom(scrollRef);
      }
    },
    [
      applyOperation,
      completeness,
      flushAutosave,
      getResumeContent,
      input,
      isLoading,
      messages,
      modelConfig,
      resumeId,
      activeSessionId,
      templateId,
    ],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center justify-end border-b px-4 py-3">
        <div className="flex items-center gap-1">
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="历史对话"
                  className="h-7 w-7 rounded-md p-0"
                />
              }
            >
              <Clock className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="border-b px-4 py-3">
                <p className="truncate text-sm font-medium text-foreground">
                  {title || "当前简历"}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {sessionsLoaded
                    ? `${sessions.length} 个对话 · ${messages.length} 条消息`
                    : "正在读取历史对话"}
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void switchSession(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void switchSession(session.id);
                      }
                    }}
                    className={`group flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted ${
                      session.id === activeSessionId ? "bg-muted/60" : ""
                    }`}
                  >
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {session.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatSessionTime(session.updatedAt)}
                      </span>
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`删除对话：${session.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteSession(session.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void deleteSession(session.id);
                        }
                      }}
                      className="mt-0.5 hidden rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline-flex"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                ))}
                {sessions.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    暂无历史对话
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="新对话"
            onClick={() => void createNewSession().catch(() => toast.error("创建新对话失败"))}
            className="h-7 w-7 rounded-md p-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <FloatingWelcome />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <FloatingMessage
                key={message.id}
                message={message}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            ))}
            {isLoading ? <FloatingTyping /> : null}
          </div>
        )}
      </div>

      <FloatingAgentInput
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        modelName={modelConfig?.modelName ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
        onSubmit={sendMessage}
      />
      <FloatingModelSettingsDialog
        open={settingsOpen}
        settings={modelSettings}
        onOpenChange={setSettingsOpen}
        onSave={setModelSettings}
      />
    </div>
  );
}

function finalAssistantMessage(
  body: Record<string, unknown>,
  operations: ResumeOperation[],
) {
  return typeof body.message === "string" && body.message.trim()
    ? body.message.trim()
    : operations.length > 0
      ? `已直接应用 ${operations.length} 条简历修改。`
      : "我看完了，可以继续告诉我你想优化的方向。";
}

function scrollMessagesToBottom(ref: React.RefObject<HTMLDivElement | null>) {
  queueMicrotask(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });
}

function isEventStreamResponse(response: Response) {
  return response.headers.get("content-type")?.includes("text/event-stream") ?? false;
}

async function readFloatingAgentStream(
  response: Response,
  {
    onTextDelta,
    onToolCall,
    onOperations,
  }: {
    onTextDelta: (delta: string) => void;
    onToolCall: (toolCall: FloatingAgentToolCall) => void;
    onOperations: (operations: ResumeOperation[]) => void;
  },
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("AI 助手响应为空");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEvent: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeFloatingStreamBuffer(buffer, (event) => {
      handleFloatingStreamEvent(event, { onTextDelta, onToolCall, onOperations }, (done) => {
        doneEvent = done;
      });
    });
  }

  buffer += decoder.decode();
  consumeFloatingStreamBuffer(`${buffer}\n\n`, (event) => {
    handleFloatingStreamEvent(event, { onTextDelta, onToolCall, onOperations }, (done) => {
      doneEvent = done;
    });
  });

  return doneEvent ?? {};
}

function handleFloatingStreamEvent(
  event: Record<string, unknown>,
  handlers: {
    onTextDelta: (delta: string) => void;
    onToolCall: (toolCall: FloatingAgentToolCall) => void;
    onOperations: (operations: ResumeOperation[]) => void;
  },
  onDone: (event: Record<string, unknown>) => void,
) {
  if (event.type === "text-delta" && typeof event.delta === "string") {
    handlers.onTextDelta(event.delta);
    return;
  }
  if (
    event.type === "tool-call-start" ||
    event.type === "tool-call-delta" ||
    event.type === "tool-call-result"
  ) {
    const toolCall = normalizeToolCall(event.toolCall);
    if (toolCall) handlers.onToolCall(toolCall);
    const operations = normalizeResumeOperations(event.operations);
    if (operations.length > 0) handlers.onOperations(operations);
    return;
  }
  if (event.type === "done") {
    onDone(event);
    return;
  }
  if (event.type === "error") {
    throw new Error(
      typeof event.error === "string" ? event.error : "AI 助手暂时不可用",
    );
  }
}

function consumeFloatingStreamBuffer(
  buffer: string,
  onEvent: (event: Record<string, unknown>) => void,
) {
  let nextBuffer = buffer;
  while (true) {
    const separatorIndex = nextBuffer.indexOf("\n\n");
    if (separatorIndex === -1) break;
    const rawEvent = nextBuffer.slice(0, separatorIndex);
    nextBuffer = nextBuffer.slice(separatorIndex + 2);
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    const event = JSON.parse(data) as Record<string, unknown>;
    onEvent(event);
  }
  return nextBuffer;
}

function FloatingWelcome() {
  return (
    <div className="flex min-h-[360px] flex-col justify-end pb-16 pt-24">
      <p className="text-3xl font-semibold leading-tight text-foreground">
        你好。
      </p>
      <p className="mt-2 text-2xl leading-tight text-muted-foreground">
        想怎么优化这份简历？
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {["从 0 创建简历", "帮我找最值得改的一处", "按 STAR 优化最近经历", "检查导出前风险"].map((label) => (
          <button
            key={label}
            type="button"
            className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FloatingMessage({
  message,
  onOpenSettings,
}: {
  message: FloatingAgentMessage;
  onOpenSettings: () => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        data-testid={isUser ? "agent-user-avatar" : "agent-assistant-avatar"}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-zinc-700" : "bg-gradient-to-br from-sky-600 to-teal-600"
        }`}
      >
        {isUser ? (
          <User className="h-3 w-3 text-white" />
        ) : (
          <Bot className="h-3 w-3 text-white" />
        )}
      </div>
      <div
        data-testid={isUser ? "agent-user-message-bubble" : "agent-assistant-message-bubble"}
        className={`min-w-0 max-w-[calc(100%-2.5rem)] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
          isUser
            ? "bg-zinc-800 text-white"
            : "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200/60 dark:bg-muted/30 dark:text-foreground dark:ring-border"
        }`}
      >
        {message.content === MODEL_MISSING_MESSAGE ? (
          <ModelMissingCard onConfigure={onOpenSettings} />
        ) : isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : message.parts && message.parts.length > 0 ? (
          <div className="space-y-2">
            {message.parts.map((part) =>
              part.type === "text" ? (
                <FloatingMarkdown key={part.id} text={part.text} />
              ) : (
                <FloatingToolCallCard key={part.id} toolCall={part.toolCall} />
              ),
            )}
          </div>
        ) : (
          <>
            <FloatingMarkdown text={message.content} />
            {message.toolCalls && message.toolCalls.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {message.toolCalls.map((toolCall) => (
                  <FloatingToolCallCard key={toolCall.id} toolCall={toolCall} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function FloatingMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="ai-markdown space-y-2 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-500 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-zinc-900 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-100 [&_strong]:font-semibold [&_td]:border [&_td]:border-zinc-200 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-white [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 dark:[&_blockquote]:border-border dark:[&_code]:bg-muted dark:[&_td]:border-border dark:[&_th]:border-border dark:[&_th]:bg-background">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ table: FloatingMarkdownTable }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function FloatingMarkdownTable({
  node: _node,
  className,
  ...props
}: ComponentProps<"table"> & { node?: unknown }) {
  void _node;
  return (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-zinc-200 dark:border-border">
      <table
        {...props}
        className={[
          "w-full min-w-max border-collapse text-left text-xs leading-relaxed",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </div>
  );
}

function FloatingToolCallCard({
  toolCall,
}: {
  toolCall: FloatingAgentToolCall;
}) {
  const isCompleted = toolCall.status === "completed";
  const isError = toolCall.status === "error";
  const callPayload = formatToolPayload(
    toolCall.input ?? { summary: toolCall.summary },
  );
  const resultPayload = formatToolPayload(
    isError
      ? toolCall.errorText || toolCall.summary || "工具调用失败"
      : toolCall.output ?? { success: true, summary: toolCall.summary },
  );

  return (
    <div className="my-2 space-y-1.5 text-xs">
      <FloatingCollapsibleBlock
        label={formatToolCallTitle(toolCall)}
        icon={
          !isCompleted && !isError ? (
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-zinc-300 border-t-zinc-600" />
          ) : (
            <Terminal className="h-3 w-3 shrink-0" />
          )
        }
        content={callPayload}
      />
      {(isCompleted || isError) ? (
        <FloatingCollapsibleBlock
          label="执行结果"
          icon={<Play className="h-3 w-3 shrink-0" />}
          statusIcon={
            isError ? (
              <XCircle className="h-3 w-3 text-red-500" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            )
          }
          content={resultPayload}
        />
      ) : null}
    </div>
  );
}

function FloatingCollapsibleBlock({
  label,
  icon,
  statusIcon,
  content,
  defaultOpen = false,
}: {
  label: string;
  icon: ReactNode;
  statusIcon?: ReactNode;
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-border dark:bg-muted/30">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:text-muted-foreground dark:hover:bg-muted"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {icon}
        <span>{label}</span>
        {statusIcon ? <span className="ml-auto">{statusIcon}</span> : null}
      </button>
      {open ? (
        <div className="border-t border-zinc-200 bg-zinc-900 px-3 py-2 dark:border-border">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-300">
            {content}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function formatToolPayload(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatToolCallTitle(toolCall: FloatingAgentToolCall) {
  const titleByName: Record<string, string> = {
    readResume: "读取简历",
    updateSection: "更新简历内容",
    addSection: "新增简历内容",
    rewriteText: "润色文本",
    suggestSkills: "更新技能",
    analyzeJobMatch: "分析岗位匹配",
  };
  return titleByName[toolCall.name] ?? (toolCall.summary || "执行动作");
}

function ModelMissingCard({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-amber-700">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">需要先连接模型</span>
      </div>
      <p className="text-[12px] text-amber-700/80">
        请先填写模型服务地址、访问密钥和模型名称。密钥只保存在当前浏览器会话中。
      </p>
      <button
        type="button"
        onClick={onConfigure}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-[12px] font-medium text-amber-800 hover:bg-amber-200"
      >
        <Settings className="h-3.5 w-3.5" />
        连接模型
      </button>
    </div>
  );
}

function FloatingTyping() {
  return (
    <div className="flex gap-2.5">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-teal-600">
        <Bot className="h-3 w-3 text-white" />
      </div>
      <div className="rounded-2xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200/60">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:240ms]" />
        </div>
      </div>
    </div>
  );
}

function FloatingAgentInput({
  input,
  setInput,
  isLoading,
  modelName,
  onOpenSettings,
  onSubmit,
}: {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  modelName: string | null;
  onOpenSettings: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t p-3">
      <div
        data-testid="agent-assistant-ui-composer-shell"
        className="rounded-2xl border border-zinc-200 bg-zinc-50/50 transition-colors focus-within:border-zinc-300 focus-within:bg-white dark:border-border dark:bg-muted/20 dark:focus-within:bg-background"
      >
        <textarea
          data-testid="agent-assistant-ui-composer-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入消息，Enter 发送"
          rows={2}
          disabled={isLoading}
          className="w-full resize-none bg-transparent px-4 pb-2 pt-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.closest("form")?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <button
            type="button"
            aria-label={`当前模型：${modelName ?? "连接模型"}`}
            onClick={onOpenSettings}
            className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 text-[11px] font-medium text-zinc-600 shadow-none hover:bg-zinc-50 dark:border-border dark:bg-background dark:text-muted-foreground"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${modelName ? "bg-emerald-400" : "bg-amber-400"}`}
            />
            <span className="truncate">{modelName ?? "连接模型"}</span>
          </button>
          <button
            type="submit"
            aria-label="发送"
            disabled={isLoading || !input.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 enabled:bg-sky-600 enabled:text-white enabled:hover:bg-sky-700"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </form>
  );
}

function FloatingModelSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  settings: AgentModelSettingsForm;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: AgentModelSettingsForm) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [modelOptions, setModelOptions] = useState<FloatingModelOption[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const canFetchModels = Boolean(draft.baseUrl.trim() && draft.apiKey.trim());

  const fetchModels = useCallback(async () => {
    const next = normalizeModelSettings(draft);
    if (!next.baseUrl || !next.apiKey) {
      setModelFetchError("请先填写模型服务地址和访问密钥");
      return;
    }

    setIsFetchingModels(true);
    setModelFetchError(null);
    try {
      const response = await fetch("/api/agent/floating/models", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUrl: next.baseUrl,
          apiKey: next.apiKey,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "获取模型失败",
        );
      }
      const models = normalizeModelOptions(body.models);
      if (models.length === 0) {
        setModelOptions([]);
        setModelFetchError("没有获取到可用模型");
        return;
      }
      setModelOptions(models);
      setDraft((current) => {
        const currentName = current.modelName.trim();
        const hasCurrent = models.some((model) => model.id === currentName);
        return {
          ...current,
          modelName: hasCurrent ? currentName : models[0].id,
        };
      });
    } catch (error) {
      setModelOptions([]);
      setModelFetchError(
        error instanceof Error ? error.message : "获取模型失败",
      );
    } finally {
      setIsFetchingModels(false);
    }
  }, [draft]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraft(settings);
          setModelOptions([]);
          setModelFetchError(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>连接模型</DialogTitle>
          <DialogDescription>
            填写你要使用的模型服务。访问密钥只保存在当前浏览器会话中。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FloatingSettingsInput
            id="floating-model-base-url"
            label="模型服务地址"
            value={draft.baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(value) => setDraft((current) => ({ ...current, baseUrl: value }))}
          />
          <FloatingSettingsInput
            id="floating-model-api-key"
            label="访问密钥"
            value={draft.apiKey}
            type="password"
            placeholder="只保存在当前浏览器"
            onChange={(value) => setDraft((current) => ({ ...current, apiKey: value }))}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              填好地址和密钥后，可以直接获取模型列表。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canFetchModels || isFetchingModels}
              onClick={fetchModels}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetchingModels ? "animate-spin" : ""}`}
              />
              获取模型
            </Button>
          </div>
          {modelFetchError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {modelFetchError}
            </p>
          ) : null}
          {modelOptions.length > 0 ? (
            <FloatingModelSelect
              id="floating-model-select"
              label="选择模型"
              value={draft.modelName}
              options={modelOptions}
              onChange={(value) => setDraft((current) => ({ ...current, modelName: value }))}
            />
          ) : (
            <FloatingSettingsInput
              id="floating-model-name"
              label="模型名称"
              value={draft.modelName}
              placeholder="gpt-4.1-mini"
              onChange={(value) => setDraft((current) => ({ ...current, modelName: value }))}
            />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => {
              const next = normalizeModelSettings(draft);
              storeModelSettings(next);
              onSave(next);
              onOpenChange(false);
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FloatingSettingsInput({
  id,
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  type?: "text" | "password";
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}

function FloatingModelSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: FloatingModelOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function createMessageId(prefix: string) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function toFloatingChatSession(value: unknown): FloatingChatSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  return {
    id: record.id.trim(),
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : "新对话",
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt.trim()
        : new Date().toISOString(),
  };
}

function isFloatingChatSession(
  value: FloatingChatSession | null,
): value is FloatingChatSession {
  return value !== null;
}

function toFloatingAgentMessage(value: unknown): FloatingAgentMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (record.role !== "user" && record.role !== "assistant") return null;
  if (typeof record.content !== "string") return null;
  const toolCalls = normalizeToolCalls(record.toolCalls);
  return {
    id: record.id.trim(),
    role: record.role,
    content: record.content,
    parts: normalizeFloatingMessageParts(record.parts),
    toolCalls,
  };
}

function isFloatingAgentMessage(
  value: FloatingAgentMessage | null,
): value is FloatingAgentMessage {
  return value !== null;
}

function appendFloatingTextPart(
  parts: FloatingAgentMessagePart[],
  delta: string,
): FloatingAgentMessagePart[] {
  if (!delta) return parts;
  const last = parts.at(-1);
  if (last?.type === "text") {
    return [
      ...parts.slice(0, -1),
      { ...last, text: last.text + delta },
    ];
  }
  return [
    ...parts,
    { id: createMessageId("part_text"), type: "text", text: delta },
  ];
}

function upsertFloatingToolPart(
  parts: FloatingAgentMessagePart[],
  toolCall: FloatingAgentToolCall,
): FloatingAgentMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === "tool" && part.toolCall.id === toolCall.id,
  );
  if (index === -1) {
    return [
      ...parts,
      { id: `part_tool_${toolCall.id}`, type: "tool", toolCall },
    ];
  }
  const next = [...parts];
  const existing = next[index];
  next[index] = {
    id: existing.id,
    type: "tool",
    toolCall: mergeFloatingToolCalls(
      existing.type === "tool" ? [existing.toolCall] : [],
      [toolCall],
    )[0],
  };
  return next;
}

function finalizeFloatingParts(
  parts: FloatingAgentMessagePart[],
  finalText: string,
  toolCalls: FloatingAgentToolCall[],
): FloatingAgentMessagePart[] {
  let next = parts;
  for (const toolCall of toolCalls) {
    next = upsertFloatingToolPart(next, toolCall);
  }
  const hasText = next.some((part) => part.type === "text" && part.text.trim());
  if (!hasText && finalText.trim()) {
    next = appendFloatingTextPart(next, finalText.trim());
  }
  return next;
}

function normalizeFloatingMessageParts(
  value: unknown,
): FloatingAgentMessagePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((item) => {
    const part = normalizeFloatingMessagePart(item);
    return part ? [part] : [];
  });
  return parts.length > 0 ? parts : undefined;
}

function normalizeFloatingMessagePart(
  value: unknown,
): FloatingAgentMessagePart | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : createMessageId("part");
  if (record.type === "text" && typeof record.text === "string") {
    return { id, type: "text", text: record.text };
  }
  if (record.type === "tool") {
    const toolCall = normalizeToolCall(record.toolCall);
    if (!toolCall) return null;
    return { id, type: "tool", toolCall };
  }
  return null;
}

function mergeFloatingToolCalls(
  current: FloatingAgentToolCall[],
  incoming: FloatingAgentToolCall[],
) {
  const merged = new Map<string, FloatingAgentToolCall>();
  for (const toolCall of current) {
    merged.set(toolCall.id, toolCall);
  }
  for (const toolCall of incoming) {
    const existing = merged.get(toolCall.id);
    merged.set(toolCall.id, {
      ...(existing ?? {}),
      ...toolCall,
      input: toolCall.input ?? existing?.input,
      output: toolCall.output ?? existing?.output,
      errorText: toolCall.errorText ?? existing?.errorText,
    });
  }
  return [...merged.values()];
}

function normalizeToolCalls(value: unknown): FloatingAgentToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const toolCall = normalizeToolCall(item);
    return toolCall ? [toolCall] : [];
  });
}

function normalizeToolCall(value: unknown): FloatingAgentToolCall | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  return {
    id: record.id,
    name: record.name,
    status:
      record.status === "running"
        ? "running"
        : record.status === "error"
          ? "error"
          : "completed",
    summary: typeof record.summary === "string" ? record.summary : "",
    input: record.input,
    output: record.output,
    errorText: typeof record.errorText === "string" ? record.errorText : undefined,
  };
}

function normalizeResumeOperations(value: unknown): ResumeOperation[] {
  return Array.isArray(value) ? (value as ResumeOperation[]) : [];
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} · ${hour}:${minute}`;
}

function readStoredModelSettings(): AgentModelSettingsForm {
  if (typeof window === "undefined") return emptyModelSettings();
  try {
    const raw = window.localStorage.getItem(MODEL_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") {
      return { ...emptyModelSettings(), apiKey: readSessionModelApiKey() };
    }
    return normalizeModelSettings({
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey: readSessionModelApiKey(),
      modelName: typeof parsed.modelName === "string" ? parsed.modelName : "",
    });
  } catch {
    return emptyModelSettings();
  }
}

function storeModelSettings(settings: AgentModelSettingsForm) {
  if (typeof window === "undefined") return;
  const normalized = normalizeModelSettings(settings);
  window.localStorage.setItem(
    MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      baseUrl: normalized.baseUrl,
      modelName: normalized.modelName,
    }),
  );
  if (normalized.apiKey) {
    window.sessionStorage.setItem(
      MODEL_API_KEY_SESSION_STORAGE_KEY,
      normalized.apiKey,
    );
  } else {
    window.sessionStorage.removeItem(MODEL_API_KEY_SESSION_STORAGE_KEY);
  }
}

function readSessionModelApiKey() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(MODEL_API_KEY_SESSION_STORAGE_KEY) ?? "";
}

function emptyModelSettings(): AgentModelSettingsForm {
  return { baseUrl: "", apiKey: "", modelName: "" };
}

function normalizeModelSettings(settings: AgentModelSettingsForm) {
  return {
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
    modelName: settings.modelName.trim(),
  };
}

function toAgentModelConfig(settings: AgentModelSettingsForm): AgentModelConfig | null {
  const normalized = normalizeModelSettings(settings);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.modelName) return null;
  return normalized;
}

function normalizeModelOptions(value: unknown): FloatingModelOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: FloatingModelOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = "id" in item && typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const label =
      "label" in item && typeof item.label === "string" && item.label.trim()
        ? item.label.trim()
        : id;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}
