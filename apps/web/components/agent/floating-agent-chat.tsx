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
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  MessageSquare,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  SendHorizonal,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
  User,
  Zap,
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
import { AgentConfirmationCard } from "@/components/agent/agent-confirmation-card";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type {
  AgentModelConfig,
  AgentOperationApprovalRequest,
  AgentResumeContext,
  AgentWriteMode,
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
  | { id: string; type: "tool"; toolCall: FloatingAgentToolCall }
  | { id: string; type: "approval"; approvalRequest: AgentOperationApprovalRequest }
  | { id: string; type: "question"; question: FloatingQuestionRequest };

type FloatingAgentToolCall = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  summary: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type FloatingApprovalContinuation = {
  titleSource: string;
};

type FloatingApprovalDecision = {
  approvalId: string;
  approved: boolean;
};

type FloatingQuestionRequest = {
  id: string;
  question: string;
  field?: string;
  status: "pending" | "answered";
  answer?: string;
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
const FLOATING_WRITE_MODE_STORAGE_KEY =
  "intro-builder.agent.floating.operation-mode.v1";
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
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [pendingApprovalMessageIds, setPendingApprovalMessageIds] = useState<
    Set<string>
  >(() => new Set());
  const [modelSettings, setModelSettings] = useState<AgentModelSettingsForm>(
    () => emptyModelSettings(),
  );
  const [writeMode, setWriteModeState] = useState<AgentWriteMode>("direct");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<FloatingAgentMessage[]>([]);
  const creatingSessionRef = useRef(false);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const pendingApprovalContinuationsRef = useRef(
    new Map<string, FloatingApprovalContinuation>(),
  );
  const modelConfig = useMemo(
    () => toAgentModelConfig(modelSettings),
    [modelSettings],
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const regenerableAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      if (message.content === MODEL_MISSING_MESSAGE) return null;
      const hasPreviousUserMessage = messages
        .slice(0, index)
        .some((item) => item.role === "user" && item.content.trim().length > 0);
      return hasPreviousUserMessage ? message.id : null;
    }
    return null;
  }, [messages]);
  const hasPendingApprovalContinuation = useMemo(
    () =>
      messages.some(
        (message) =>
          pendingApprovalMessageIds.has(message.id) &&
          hasPendingApprovalParts(message),
      ),
    [messages, pendingApprovalMessageIds],
  );
  const hasPendingQuestionContinuation = useMemo(
    () => messages.some(hasPendingQuestionParts),
    [messages],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModelSettings(readStoredModelSettings());
      setWriteModeState(readStoredWriteMode());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setWriteMode = useCallback((nextMode: AgentWriteMode) => {
    setWriteModeState(nextMode);
    storeWriteMode(nextMode);
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    pendingApprovalContinuationsRef.current.clear();
    setPendingApprovalMessageIds(new Set());
    setLoadingSessionId(sessionId);
    const response = await fetch(`/api/agent/floating/sessions/${sessionId}`, {
      headers: { Accept: "application/json" },
    });
    try {
      if (!response.ok) throw new Error("读取历史对话失败");
      const body = await response.json().catch(() => ({}));
      const session = toFloatingChatSession(body.session);
      if (session) {
        setSessions((current) =>
          current.map((item) => (item.id === session.id ? session : item)),
        );
      }
      const loadedMessages = Array.isArray(body.messages)
        ? body.messages.map(toFloatingAgentMessage).filter(isFloatingAgentMessage)
        : [];
      setMessages(loadedMessages);
    } finally {
      setLoadingSessionId((current) => (current === sessionId ? null : current));
    }
  }, []);

  const createNewSession = useCallback(async () => {
    if (creatingSessionRef.current) return null;
    creatingSessionRef.current = true;
    const optimisticSession: FloatingChatSession = {
      id: createMessageId("session_pending"),
      title: "正在创建...",
      updatedAt: new Date().toISOString(),
    };
    setIsCreatingSession(true);
    setSessions((current) => [optimisticSession, ...current]);
    setActiveSessionId(optimisticSession.id);
    setMessages([]);
    pendingApprovalContinuationsRef.current.clear();
    setPendingApprovalMessageIds(new Set());
    setInput("");
    setEditingMessageId(null);
    setHistoryOpen(false);
    try {
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
      setSessions((current) => [
        session,
        ...current.filter(
          (item) => item.id !== session.id && item.id !== optimisticSession.id,
        ),
      ]);
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setSessions((current) =>
        current.filter((item) => item.id !== optimisticSession.id),
      );
      setActiveSessionId((current) =>
        current === optimisticSession.id ? null : current,
      );
      throw error;
    } finally {
      creatingSessionRef.current = false;
      setIsCreatingSession(false);
    }
  }, [resumeId]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) {
        setHistoryOpen(false);
        return;
      }
      setActiveSessionId(sessionId);
      setMessages([]);
      setLoadingSessionId(sessionId);
      pendingApprovalContinuationsRef.current.clear();
      setPendingApprovalMessageIds(new Set());
      setEditingMessageId(null);
      setInput("");
      setHistoryOpen(false);
      try {
        await loadSessionMessages(sessionId);
      } catch (error) {
        setMessages([]);
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
          setInput("");
          setEditingMessageId(null);
        });
      }
    },
    [activeSessionId, createNewSession, loadSessionMessages, sessions],
  );

  const persistApprovalStatus = useCallback(
    async (
      messageId: string,
      approvalId: string,
      status: Extract<AgentOperationApprovalRequest["status"], "approved" | "rejected">,
    ) => {
      if (!activeSessionId) return;
      try {
        const response = await fetch(`/api/agent/floating/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messageId, approvalId, status }),
        });
        if (!response.ok) throw new Error("persist_failed");
      } catch {
        toast.error("确认状态保存失败");
      }
    },
    [activeSessionId],
  );

  const persistQuestionAnswer = useCallback(
    async (messageId: string, questionId: string, answer: string) => {
      if (!activeSessionId) return;
      try {
        const response = await fetch(`/api/agent/floating/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messageId, questionId, answer }),
        });
        if (!response.ok) throw new Error("persist_failed");
      } catch {
        toast.error("回复状态保存失败");
      }
    },
    [activeSessionId],
  );

  const copyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard?.writeText(content);
      toast.success("已复制消息");
    } catch {
      toast.error("复制失败");
    }
  }, []);

  const editUserMessage = useCallback(
    (message: FloatingAgentMessage) => {
      if (
        isLoading ||
        hasPendingApprovalContinuation ||
        hasPendingQuestionContinuation ||
        message.role !== "user"
      ) return;
      setEditingMessageId(message.id);
      setInput(message.content);
    },
    [hasPendingApprovalContinuation, hasPendingQuestionContinuation, isLoading],
  );

  const cancelEditing = useCallback(() => {
    setEditingMessageId(null);
    setInput("");
  }, []);

  const runFloatingRequest = useCallback(
    async ({
      requestMessages,
      initialMessages,
      titleSource,
      approvalDecisions = [],
      persistLastUserMessage = true,
    }: {
      requestMessages: FloatingAgentMessage[];
      initialMessages: FloatingAgentMessage[];
      titleSource: string;
      approvalDecisions?: FloatingApprovalDecision[];
      persistLastUserMessage?: boolean;
    }) => {
      setMessages(initialMessages);

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
      const abortController = new AbortController();
      requestAbortControllerRef.current?.abort();
      requestAbortControllerRef.current = abortController;
      const assistantMessageId = createMessageId("assistant");
      const appliedOperationIds = new Set<string>();
      const applyStreamOperations = (operations: ResumeOperation[]) => {
        if (writeMode !== "direct") return;
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
          signal: abortController.signal,
          headers: {
            Accept: FLOATING_STREAM_ACCEPT_HEADER,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resumeId,
            locale: "zh-CN",
            workflowId: null satisfies AgentWorkflowId | null,
            sessionId: activeSessionId,
            writeMode,
            approvalDecisions,
            persistLastUserMessage,
            messages: requestMessages.map((message) => ({
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
            onApprovalRequest: (approvalRequest) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        parts: upsertFloatingApprovalPart(
                          message.parts ?? [],
                          approvalRequest,
                        ),
                      }
                    : message,
                ),
              );
              scrollMessagesToBottom(scrollRef);
            },
            onQuestionRequest: (question) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        parts: upsertFloatingQuestionPart(
                          message.parts ?? [],
                          question,
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

        const operations =
          writeMode === "direct"
            ? normalizeResumeOperations(body.operations).filter(
                (operation) => !appliedOperationIds.has(operation.id),
              )
            : [];
        const approvalRequests = normalizeApprovalRequests(body.approvalRequests);
        const questions = normalizeFloatingQuestions(body.questions);
        if (writeMode === "approval" && hasPendingApprovalRequests(approvalRequests)) {
          pendingApprovalContinuationsRef.current.set(assistantMessageId, {
            titleSource,
          });
          setPendingApprovalMessageIds((current) => {
            const next = new Set(current);
            next.add(assistantMessageId);
            return next;
          });
        } else {
          pendingApprovalContinuationsRef.current.delete(assistantMessageId);
          setPendingApprovalMessageIds((current) => {
            const next = new Set(current);
            next.delete(assistantMessageId);
            return next;
          });
        }
        const toolCalls = normalizeToolCalls(body.toolCalls);
        const responseParts = normalizeFloatingMessageParts(body.parts);
        applyStreamOperations(operations);
        if (activeSessionId) {
          const nextTitle = titleSource.slice(0, 50);
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
                      content: finalAssistantMessage(body, operations, approvalRequests),
                      parts:
                        responseParts ??
                        finalizeFloatingParts(
                          message.parts ?? [],
                          finalAssistantMessage(body, operations, approvalRequests),
                          toolCalls,
                          approvalRequests,
                          questions,
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
                  content: finalAssistantMessage(body, operations, approvalRequests),
                  parts:
                    responseParts ??
                    finalizeFloatingParts(
                      [],
                      finalAssistantMessage(body, operations, approvalRequests),
                      toolCalls,
                      approvalRequests,
                      questions,
                    ),
                  toolCalls,
                },
              ]),
        ]);
      } catch (error) {
        if (isAbortError(error)) return;
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
        if (requestAbortControllerRef.current === abortController) {
          requestAbortControllerRef.current = null;
        }
        setIsLoading(false);
        scrollMessagesToBottom(scrollRef);
      }
    },
    [
      activeSessionId,
      applyOperation,
      completeness,
      flushAutosave,
      getResumeContent,
      modelConfig,
      resumeId,
      templateId,
      writeMode,
    ],
  );

  const continuePendingApprovalRun = useCallback(
    (messageId: string, nextMessages: FloatingAgentMessage[]) => {
      const continuation = pendingApprovalContinuationsRef.current.get(messageId);
      if (!continuation) return;

      const targetMessage = nextMessages.find((message) => message.id === messageId);
      const decisions = approvalDecisionsForMessage(targetMessage);
      if (decisions.length === 0) return;

      pendingApprovalContinuationsRef.current.delete(messageId);
      setPendingApprovalMessageIds((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
      void runFloatingRequest({
        requestMessages: nextMessages,
        initialMessages: nextMessages,
        titleSource: continuation.titleSource,
        approvalDecisions: decisions,
        persistLastUserMessage: false,
      });
    },
    [runFloatingRequest],
  );

  const applyApprovalRequest = useCallback(
    (messageId: string, operation: ResumeOperation) => {
      applyOperation(operation);
      flushAutosave();
      const nextMessages = updateFloatingApprovalStatus(
        messagesRef.current,
        operation.id,
        "approved",
      );
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      void persistApprovalStatus(messageId, operation.id, "approved");
      continuePendingApprovalRun(messageId, nextMessages);
    },
    [
      applyOperation,
      continuePendingApprovalRun,
      flushAutosave,
      persistApprovalStatus,
    ],
  );

  const rejectApprovalRequest = useCallback(
    (messageId: string, operationId: string) => {
      const nextMessages = updateFloatingApprovalStatus(
        messagesRef.current,
        operationId,
        "rejected",
      );
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      void persistApprovalStatus(messageId, operationId, "rejected");
      continuePendingApprovalRun(messageId, nextMessages);
    },
    [continuePendingApprovalRun, persistApprovalStatus],
  );

  const answerQuestionRequest = useCallback(
    (messageId: string, questionId: string, answer: string) => {
      const trimmedAnswer = answer.trim();
      if (!trimmedAnswer || isLoading) return;
      const targetMessage = messagesRef.current.find((message) => message.id === messageId);
      const question = findQuestionInMessage(targetMessage, questionId);
      if (!question) return;
      const answeredMessages = updateFloatingQuestionAnswer(
        messagesRef.current,
        questionId,
        trimmedAnswer,
      );
      const answerMessage: FloatingAgentMessage = {
        id: createMessageId("user"),
        role: "user",
        content: `关于「${question.question}」：${trimmedAnswer}`,
      };
      const nextMessages = [...answeredMessages, answerMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      scrollMessagesToBottom(scrollRef);
      void persistQuestionAnswer(messageId, questionId, trimmedAnswer);
      void runFloatingRequest({
        requestMessages: nextMessages,
        initialMessages: nextMessages,
        titleSource: trimmedAnswer,
      });
    },
    [isLoading, persistQuestionAnswer, runFloatingRequest],
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
      if (!text || isLoading || hasPendingApprovalContinuation || hasPendingQuestionContinuation) return;
      const editingIndex = editingMessageId
        ? messages.findIndex(
            (message) => message.id === editingMessageId && message.role === "user",
          )
        : -1;
      const baseMessages = editingIndex >= 0 ? messages.slice(0, editingIndex) : messages;

      const userMessage: FloatingAgentMessage = {
        id: createMessageId("user"),
        role: "user",
        content: text,
      };
      setMessages([...baseMessages, userMessage]);
      setEditingMessageId(null);
      setInput("");
      scrollMessagesToBottom(scrollRef);

      await runFloatingRequest({
        requestMessages: [...baseMessages, userMessage],
        initialMessages: [...baseMessages, userMessage],
        titleSource: text,
      });
    },
    [
      editingMessageId,
      hasPendingApprovalContinuation,
      hasPendingQuestionContinuation,
      input,
      isLoading,
      messages,
      runFloatingRequest,
    ],
  );

  const regenerateAssistantMessage = useCallback(
    async (message: FloatingAgentMessage) => {
      if (
        isLoading ||
        hasPendingApprovalContinuation ||
        hasPendingQuestionContinuation ||
        message.role !== "assistant"
      ) return;
      const assistantIndex = messages.findIndex((item) => item.id === message.id);
      if (assistantIndex <= 0) return;
      const requestMessages = messages.slice(0, assistantIndex);
      const previousUserMessage = [...requestMessages]
        .reverse()
        .find((item) => item.role === "user" && item.content.trim().length > 0);
      if (!previousUserMessage) return;
      setEditingMessageId(null);
      setInput("");
      await runFloatingRequest({
        requestMessages,
        initialMessages: requestMessages,
        titleSource: previousUserMessage.content.trim(),
      });
    },
    [
      hasPendingApprovalContinuation,
      hasPendingQuestionContinuation,
      isLoading,
      messages,
      runFloatingRequest,
    ],
  );

  const sendWelcomePrompt = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text || isLoading || hasPendingApprovalContinuation || hasPendingQuestionContinuation) return;
      const userMessage: FloatingAgentMessage = {
        id: createMessageId("user"),
        role: "user",
        content: text,
      };
      const nextMessages = [...messages, userMessage];
      setEditingMessageId(null);
      setInput("");
      setMessages(nextMessages);
      scrollMessagesToBottom(scrollRef);
      await runFloatingRequest({
        requestMessages: nextMessages,
        initialMessages: nextMessages,
        titleSource: text,
      });
    },
    [
      hasPendingApprovalContinuation,
      hasPendingQuestionContinuation,
      isLoading,
      messages,
      runFloatingRequest,
    ],
  );

  const stopGeneration = useCallback(() => {
    requestAbortControllerRef.current?.abort();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {activeSession?.title ?? (sessionsLoaded ? "新对话" : "读取对话中")}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {loadingSessionId
              ? "正在读取消息"
              : isCreatingSession
                ? "正在创建新对话"
                : title || "当前简历"}
          </p>
        </div>
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
                        {session.id === loadingSessionId
                          ? "正在读取消息"
                          : session.title === "正在创建..."
                            ? "请稍候"
                            : formatSessionTime(session.updatedAt)}
                      </span>
                    </span>
                    {session.id === loadingSessionId ||
                    session.title === "正在创建..." ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : null}
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
            disabled={isCreatingSession}
            onClick={() => void createNewSession().catch(() => toast.error("创建新对话失败"))}
            className="h-7 w-7 rounded-md p-0"
          >
            {isCreatingSession ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!sessionsLoaded || loadingSessionId ? (
          <FloatingConversationLoading
            label={!sessionsLoaded ? "正在读取历史对话" : "正在切换对话"}
          />
        ) : messages.length === 0 ? (
          <FloatingWelcome onPromptClick={sendWelcomePrompt} />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <FloatingMessage
                key={message.id}
                message={message}
                onOpenSettings={() => setSettingsOpen(true)}
                onApplyApproval={applyApprovalRequest}
                onRejectApproval={rejectApprovalRequest}
                onAnswerQuestion={answerQuestionRequest}
                onCopyMessage={copyMessage}
                onEditMessage={editUserMessage}
                onRegenerateMessage={regenerateAssistantMessage}
                canRegenerate={
                  !isLoading &&
                  !hasPendingApprovalContinuation &&
                  !hasPendingQuestionContinuation &&
                  message.id === regenerableAssistantMessageId
                }
                isLoading={isLoading}
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
        isAwaitingApproval={hasPendingApprovalContinuation}
        isAwaitingQuestion={hasPendingQuestionContinuation}
        modelName={modelConfig?.modelName ?? null}
        editing={editingMessageId !== null}
        writeMode={writeMode}
        onWriteModeChange={setWriteMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onCancelEditing={cancelEditing}
        onStop={stopGeneration}
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
  approvalRequests: AgentOperationApprovalRequest[] = [],
) {
  return typeof body.message === "string" && body.message.trim()
    ? body.message.trim()
    : approvalRequests.length > 0
      ? `我整理了 ${approvalRequests.length} 条修改建议，请确认后应用。`
      : operations.length > 0
        ? `已直接应用 ${operations.length} 条简历修改。`
        : "我看完了，可以继续告诉我你想优化的方向。";
}

function hasPendingApprovalRequests(
  approvalRequests: AgentOperationApprovalRequest[],
) {
  return approvalRequests.some((request) => request.status === "pending");
}

function hasPendingApprovalParts(message: FloatingAgentMessage) {
  return (
    message.parts?.some(
      (part) =>
        part.type === "approval" && part.approvalRequest.status === "pending",
    ) ?? false
  );
}

function hasPendingQuestionParts(message: FloatingAgentMessage) {
  return (
    message.parts?.some(
      (part) => part.type === "question" && part.question.status === "pending",
    ) ?? false
  );
}

function updateFloatingApprovalStatus(
  messages: FloatingAgentMessage[],
  approvalId: string,
  status: Extract<AgentOperationApprovalRequest["status"], "approved" | "rejected">,
) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts?.map((part) =>
      part.type === "approval" && part.approvalRequest.id === approvalId
        ? {
            ...part,
            approvalRequest: {
              ...part.approvalRequest,
              status,
            },
          }
        : part,
    ),
  }));
}

function findQuestionInMessage(
  message: FloatingAgentMessage | undefined,
  questionId: string,
) {
  for (const part of message?.parts ?? []) {
    if (part.type === "question" && part.question.id === questionId) {
      return part.question;
    }
  }
  return null;
}

function updateFloatingQuestionAnswer(
  messages: FloatingAgentMessage[],
  questionId: string,
  answer: string,
) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts?.map((part) =>
      part.type === "question" && part.question.id === questionId
        ? {
            ...part,
            question: {
              ...part.question,
              status: "answered" as const,
              answer,
            },
          }
        : part,
    ),
  }));
}

function approvalDecisionsForMessage(
  message: FloatingAgentMessage | undefined,
): FloatingApprovalDecision[] {
  const approvalParts =
    message?.parts?.filter((part) => part.type === "approval") ?? [];
  if (approvalParts.length === 0) return [];
  if (
    approvalParts.some(
      (part) =>
        part.approvalRequest.status !== "approved" &&
        part.approvalRequest.status !== "rejected",
    )
  ) {
    return [];
  }
  return approvalParts.map((part) => ({
    approvalId: part.approvalRequest.id,
    approved: part.approvalRequest.status === "approved",
  }));
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readFloatingAgentStream(
  response: Response,
  {
    onTextDelta,
    onToolCall,
    onApprovalRequest,
    onQuestionRequest,
    onOperations,
  }: {
    onTextDelta: (delta: string) => void;
    onToolCall: (toolCall: FloatingAgentToolCall) => void;
    onApprovalRequest: (approvalRequest: AgentOperationApprovalRequest) => void;
    onQuestionRequest: (question: FloatingQuestionRequest) => void;
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
      handleFloatingStreamEvent(
        event,
        { onTextDelta, onToolCall, onApprovalRequest, onQuestionRequest, onOperations },
        (done) => {
          doneEvent = done;
        },
      );
    });
  }

  buffer += decoder.decode();
  consumeFloatingStreamBuffer(`${buffer}\n\n`, (event) => {
    handleFloatingStreamEvent(
      event,
      { onTextDelta, onToolCall, onApprovalRequest, onQuestionRequest, onOperations },
      (done) => {
        doneEvent = done;
      },
    );
  });

  return doneEvent ?? {};
}

function handleFloatingStreamEvent(
  event: Record<string, unknown>,
  handlers: {
    onTextDelta: (delta: string) => void;
    onToolCall: (toolCall: FloatingAgentToolCall) => void;
    onApprovalRequest: (approvalRequest: AgentOperationApprovalRequest) => void;
    onQuestionRequest: (question: FloatingQuestionRequest) => void;
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
  if (event.type === "approval-request") {
    const approvalRequest = normalizeApprovalRequest(event.approvalRequest);
    if (approvalRequest) handlers.onApprovalRequest(approvalRequest);
    return;
  }
  if (event.type === "question-request") {
    const question = normalizeFloatingQuestion(event.question);
    if (question) handlers.onQuestionRequest(question);
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

function FloatingWelcome({
  onPromptClick,
}: {
  onPromptClick: (prompt: string) => void;
}) {
  const prompts = [
    "从 0 创建简历",
    "帮我找最值得改的一处",
    "按 STAR 优化最近经历",
    "检查导出前风险",
  ];
  return (
    <div className="flex min-h-[360px] flex-col justify-end pb-16 pt-24">
      <p className="text-3xl font-semibold leading-tight text-foreground">
        你好。
      </p>
      <p className="mt-2 text-2xl leading-tight text-muted-foreground">
        想怎么优化这份简历？
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {prompts.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onPromptClick(label)}
            className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FloatingConversationLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function FloatingMessage({
  message,
  onOpenSettings,
  onApplyApproval,
  onRejectApproval,
  onAnswerQuestion,
  onCopyMessage,
  onEditMessage,
  onRegenerateMessage,
  canRegenerate,
  isLoading,
}: {
  message: FloatingAgentMessage;
  onOpenSettings: () => void;
  onApplyApproval: (messageId: string, operation: ResumeOperation) => void;
  onRejectApproval: (messageId: string, operationId: string) => void;
  onAnswerQuestion: (messageId: string, questionId: string, answer: string) => void;
  onCopyMessage: (content: string) => void;
  onEditMessage: (message: FloatingAgentMessage) => void;
  onRegenerateMessage: (message: FloatingAgentMessage) => void;
  canRegenerate: boolean;
  isLoading: boolean;
}) {
  const isUser = message.role === "user";
  const canCopy = message.content.trim().length > 0 && message.content !== MODEL_MISSING_MESSAGE;
  return (
    <div className={`group/message flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
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
      <div className="relative min-w-0 max-w-[calc(100%-2.5rem)] pb-7">
        <div
          data-testid={isUser ? "agent-user-message-bubble" : "agent-assistant-message-bubble"}
          className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
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
                ) : part.type === "tool" ? (
                  <FloatingToolCallCard key={part.id} toolCall={part.toolCall} />
                ) : part.type === "approval" ? (
                  <AgentConfirmationCard
                    key={part.id}
                    operation={part.approvalRequest.operation}
                    status={part.approvalRequest.status}
                    onApply={(operation) => onApplyApproval(message.id, operation)}
                    onReject={(operationId) => onRejectApproval(message.id, operationId)}
                  />
                ) : (
                  <FloatingQuestionCard
                    key={part.id}
                    question={part.question}
                    onSubmit={(answer) =>
                      onAnswerQuestion(message.id, part.question.id, answer)
                    }
                  />
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
        {canCopy || isUser || canRegenerate ? (
          <div
            className={`absolute bottom-0 z-10 flex gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 ${
              isUser ? "right-0" : "left-0"
            }`}
          >
            {canCopy ? (
              <button
                type="button"
                aria-label="复制消息"
                onClick={() => onCopyMessage(message.content)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-muted dark:hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {isUser ? (
              <button
                type="button"
                aria-label="编辑消息"
                disabled={isLoading}
                onClick={() => onEditMessage(message)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-muted dark:hover:text-foreground"
              >
                <PencilLine className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canRegenerate ? (
              <button
                type="button"
                aria-label="重新生成回答"
                disabled={isLoading}
                onClick={() => onRegenerateMessage(message)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-muted dark:hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
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
    updateBasicsBlock: "更新基础信息块",
    setCandidateName: "更新姓名",
    setJobSearchStatus: "更新求职状态",
    setTargetRoleTitle: "更新目标岗位",
    setContactEmail: "更新邮箱",
    setContactPhone: "更新手机号",
    setCandidateLocation: "更新所在地",
    setPersonalWebsite: "更新个人链接",
    setCandidatePhoto: "更新候选人头像",
    writeProfileIntro: "更新个人简介",
    writeSkillsSection: "更新专业技能",
    writePersonalSummarySection: "更新个人总结",
    writeAwardsSection: "更新荣誉奖项",
    writePortfolioSection: "更新作品集",
    addCustomSection: "新增自定义模块",
    renameCustomSection: "重命名自定义模块",
    writeCustomSectionContent: "更新自定义模块内容",
    deleteCustomSection: "删除自定义模块",
    reorderCustomSections: "调整自定义模块顺序",
    updateCustomSectionBlock: "更新自定义模块",
    updateStyleSettingsBlock: "调整简历样式",
    setResumeFontFamily: "调整字体",
    setResumeFontSize: "调整正文字号",
    setResumeBodyLineHeight: "调整正文行高",
    setResumeHeadingGap: "调整标题间距",
    setResumePagePadding: "调整页边距",
    setResumeSectionGap: "调整模块间距",
    setResumeItemGap: "调整条目间距",
    setResumePhotoScale: "调整头像大小",
    addWorkExperience: "新增工作经历",
    updateWorkExperienceBlock: "更新工作经历块",
    updateWorkExperienceMeta: "更新工作经历信息",
    writeWorkExperienceContent: "改写工作经历内容",
    addEducation: "新增教育经历",
    updateEducationBlock: "更新教育经历块",
    updateEducationMeta: "更新教育经历信息",
    writeEducationHighlights: "改写教育经历亮点",
    addProject: "新增项目经历",
    updateProjectBlock: "更新项目经历块",
    updateProjectMeta: "更新项目经历信息",
    writeProjectContent: "改写项目经历内容",
    addResearch: "新增研究经历",
    updateResearchBlock: "更新研究经历块",
    updateResearchMeta: "更新研究经历信息",
    writeResearchContent: "改写研究经历内容",
    deleteWorkExperience: "删除工作经历",
    deleteEducation: "删除教育经历",
    deleteProject: "删除项目经历",
    deleteResearch: "删除研究经历",
    reorderWorkExperiences: "调整工作经历顺序",
    reorderEducation: "调整教育经历顺序",
    reorderProjects: "调整项目经历顺序",
    reorderResearch: "调整研究经历顺序",
    hideResumeModule: "隐藏简历模块",
    showResumeModule: "显示简历模块",
    reorderResumeModules: "调整模块顺序",
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

function FloatingQuestionCard({
  question,
  onSubmit,
}: {
  question: FloatingQuestionRequest;
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState(question.answer ?? "");
  const answered = question.status === "answered" && Boolean(question.answer?.trim());

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-900/70 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
          需要补充
        </span>
        {question.field ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {question.field}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-foreground">{question.question}</p>
      {answered ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-200">
          <span className="font-medium">已回复：</span>
          {question.answer}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!answer.trim()) return;
            onSubmit(answer.trim());
          }}
        >
          <input
            type="text"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="输入补充信息"
            className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!answer.trim()}>
            回复
          </Button>
        </form>
      )}
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
  isAwaitingApproval,
  isAwaitingQuestion,
  modelName,
  editing,
  writeMode,
  onWriteModeChange,
  onOpenSettings,
  onCancelEditing,
  onStop,
  onSubmit,
}: {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  isAwaitingApproval: boolean;
  isAwaitingQuestion: boolean;
  modelName: string | null;
  editing: boolean;
  writeMode: AgentWriteMode;
  onWriteModeChange: (mode: AgentWriteMode) => void;
  onOpenSettings: () => void;
  onCancelEditing: () => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const disabled = isLoading || isAwaitingApproval || isAwaitingQuestion;
  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t p-3">
      {editing ? (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[12px] text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          <span>正在编辑上一条消息</span>
          <button
            type="button"
            onClick={onCancelEditing}
            className="font-medium hover:text-sky-900 dark:hover:text-sky-100"
          >
            取消
          </button>
        </div>
      ) : null}
      <div
        data-testid="agent-assistant-ui-composer-shell"
        className="isolate overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-zinc-200 transition-colors focus-within:bg-white focus-within:ring-zinc-300 dark:bg-background dark:ring-border"
      >
        <textarea
          data-testid="agent-assistant-ui-composer-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            isAwaitingApproval
              ? "请先应用或忽略修改建议"
              : isAwaitingQuestion
                ? "请先回复上方问题"
                : "输入消息，Enter 发送"
          }
          rows={2}
          disabled={disabled}
          className="w-full resize-none bg-transparent px-4 pb-2 pt-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.closest("form")?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label={`当前模型：${modelName ?? "连接模型"}`}
              onClick={onOpenSettings}
              className="inline-flex h-7 max-w-[140px] items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 text-[11px] font-medium text-zinc-600 shadow-none hover:bg-zinc-50 dark:border-border dark:bg-background dark:text-muted-foreground"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${modelName ? "bg-emerald-400" : "bg-amber-400"}`}
              />
              <span className="truncate">{modelName ?? "连接模型"}</span>
            </button>
            <FloatingWriteModeMenu
              writeMode={writeMode}
              disabled={disabled}
              onWriteModeChange={onWriteModeChange}
            />
          </div>
          {isLoading ? (
            <button
              type="button"
              aria-label="停止生成"
              onClick={onStop}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-700 dark:bg-foreground dark:text-background dark:hover:bg-foreground/80"
            >
              <XCircle className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="发送"
              disabled={disabled || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 enabled:bg-sky-600 enabled:text-white enabled:hover:bg-sky-700"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function FloatingWriteModeMenu({
  writeMode,
  disabled,
  onWriteModeChange,
}: {
  writeMode: AgentWriteMode;
  disabled: boolean;
  onWriteModeChange: (mode: AgentWriteMode) => void;
}) {
  const current = FLOATING_WRITE_MODE_OPTIONS.find((option) => option.value === writeMode)
    ?? FLOATING_WRITE_MODE_OPTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={`修改模式：${current.label}`}
            className="inline-flex h-7 max-w-[148px] shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 text-[11px] font-medium text-zinc-600 shadow-none hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-background dark:text-muted-foreground"
          />
        }
      >
        <CurrentIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
        <span className="truncate">{current.shortLabel}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72 gap-1 rounded-xl p-1.5"
      >
        {FLOATING_WRITE_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.value === writeMode;
          return (
            <button
              key={option.value}
              type="button"
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-muted"
              onClick={() => onWriteModeChange(option.value)}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {selected ? (
                <Check className="mt-1 h-4 w-4 shrink-0 text-sky-600" />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

const FLOATING_WRITE_MODE_OPTIONS: Array<{
  value: AgentWriteMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Zap;
}> = [
  {
    value: "direct",
    label: "直接修改",
    shortLabel: "直接修改",
    description: "检测到确定可改的内容时，直接写入左侧简历并自动保存。",
    icon: Zap,
  },
  {
    value: "approval",
    label: "请求批准",
    shortLabel: "请求批准",
    description: "先生成修改卡片，等你点击应用或忽略后再继续执行。",
    icon: ShieldCheck,
  },
];

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

function upsertFloatingApprovalPart(
  parts: FloatingAgentMessagePart[],
  approvalRequest: AgentOperationApprovalRequest,
): FloatingAgentMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === "approval" && part.approvalRequest.id === approvalRequest.id,
  );
  if (index === -1) {
    return [
      ...parts,
      {
        id: `part_approval_${approvalRequest.id}`,
        type: "approval",
        approvalRequest,
      },
    ];
  }
  const next = [...parts];
  const existing = next[index];
  next[index] = {
    id: existing.id,
    type: "approval",
    approvalRequest,
  };
  return next;
}

function upsertFloatingQuestionPart(
  parts: FloatingAgentMessagePart[],
  question: FloatingQuestionRequest,
): FloatingAgentMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === "question" && part.question.id === question.id,
  );
  if (index === -1) {
    return [
      ...parts,
      {
        id: `part_question_${question.id}`,
        type: "question",
        question,
      },
    ];
  }
  const next = [...parts];
  const existing = next[index];
  next[index] = {
    id: existing.id,
    type: "question",
    question,
  };
  return next;
}

function finalizeFloatingParts(
  parts: FloatingAgentMessagePart[],
  finalText: string,
  toolCalls: FloatingAgentToolCall[],
  approvalRequests: AgentOperationApprovalRequest[] = [],
  questions: FloatingQuestionRequest[] = [],
): FloatingAgentMessagePart[] {
  let next = parts;
  for (const toolCall of toolCalls) {
    next = upsertFloatingToolPart(next, toolCall);
  }
  for (const approvalRequest of approvalRequests) {
    next = upsertFloatingApprovalPart(next, approvalRequest);
  }
  for (const question of questions) {
    next = upsertFloatingQuestionPart(next, question);
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
  if (record.type === "approval") {
    const approvalRequest = normalizeApprovalRequest(record.approvalRequest);
    if (!approvalRequest) return null;
    return { id, type: "approval", approvalRequest };
  }
  if (record.type === "question") {
    const question = normalizeFloatingQuestion(record.question);
    if (!question) return null;
    return { id, type: "question", question };
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

function normalizeApprovalRequests(value: unknown): AgentOperationApprovalRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const approvalRequest = normalizeApprovalRequest(item);
    return approvalRequest ? [approvalRequest] : [];
  });
}

function normalizeApprovalRequest(
  value: unknown,
): AgentOperationApprovalRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const operation = normalizeResumeOperation(record.operation);
  if (!operation) return null;
  const source =
    record.source && typeof record.source === "object"
      ? (record.source as Record<string, unknown>)
      : null;
  const status =
    record.status === "approved" || record.status === "rejected"
      ? record.status
      : "pending";
  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : operation.id,
    status,
    reason: "approval_required",
    message:
      typeof record.message === "string" && record.message.trim()
        ? record.message.trim()
        : operation.changeSummary,
    toolCallId:
      typeof record.toolCallId === "string" && record.toolCallId.trim()
        ? record.toolCallId.trim()
        : operation.toolCallId || null,
    source: {
      kind: source?.kind === "skill" ? "skill" : "tool",
      name:
        typeof source?.name === "string" && source.name.trim()
          ? source.name.trim()
          : "floatingAgent",
    },
    operation,
  };
}

function normalizeFloatingQuestions(value: unknown): FloatingQuestionRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const question = normalizeFloatingQuestion(item);
    return question ? [question] : [];
  });
}

function normalizeFloatingQuestion(value: unknown): FloatingQuestionRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (typeof record.question !== "string" || !record.question.trim()) return null;
  const status = record.status === "answered" ? "answered" : "pending";
  return {
    id: record.id.trim(),
    question: record.question.trim(),
    ...(typeof record.field === "string" && record.field.trim()
      ? { field: record.field.trim() }
      : {}),
    status,
    ...(typeof record.answer === "string" && record.answer.trim()
      ? { answer: record.answer.trim() }
      : {}),
  };
}

function normalizeResumeOperations(value: unknown): ResumeOperation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const operation = normalizeResumeOperation(item);
    return operation ? [operation] : [];
  });
}

function normalizeResumeOperation(value: unknown): ResumeOperation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as ResumeOperation & Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.toolCallId !== "string" ||
    typeof record.label !== "string" ||
    typeof record.section !== "string" ||
    typeof record.fieldPath !== "string" ||
    typeof record.operation !== "string" ||
    typeof record.beforePlainText !== "string" ||
    typeof record.afterPlainText !== "string" ||
    typeof record.changeSummary !== "string" ||
    !Array.isArray(record.riskFlags)
  ) {
    return null;
  }
  return record;
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

function readStoredWriteMode(): AgentWriteMode {
  if (typeof window === "undefined") return "direct";
  return window.localStorage.getItem(FLOATING_WRITE_MODE_STORAGE_KEY) === "approval"
    ? "approval"
    : "direct";
}

function storeWriteMode(mode: AgentWriteMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FLOATING_WRITE_MODE_STORAGE_KEY, mode);
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
