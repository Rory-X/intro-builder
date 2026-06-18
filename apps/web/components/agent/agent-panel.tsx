"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  useMessageRuntime,
  useThreadRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowUpDown,
  Bot,
  CheckCircle2,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Edit3,
  FilePlus2,
  Loader2,
  MessageCircleQuestion,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Square,
  X,
  Zap,
} from "lucide-react";

import { AgentConfirmationCard } from "@/components/agent/agent-confirmation-card";
import { AgentContextIndicator } from "@/components/agent/agent-context-indicator";
import {
  AgentAgUiRuntimeProvider,
  useAgentAgUiInterruptSubmit,
  type AgentAgUiInterrupt,
} from "@/components/agent/agent-ag-ui-runtime-provider";
import { AgentToolCard } from "@/components/agent/agent-tool-card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type {
  AgentMessageResponse,
  AgentContextStatusSnapshot,
  AgentModelConfig,
  AgentResumeWorkspaceSnapshot,
  AgentResumeContext,
  AgentWorkflowId,
  ResumeOperation,
} from "@intro-builder/shared/types";
import type { ResumeContent } from "@intro-builder/shared/schemas";

type AgentRetryRequest = {
  content: string;
  workflowId: AgentWorkflowId | null;
};

type AgentModelSettingsForm = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
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

type AgentPanelSurface = "panel" | "floating";

type AgentInterruptResponse = {
  interruptId: string;
  status: "resolved" | "cancelled";
  payload?: unknown;
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

const AGENT_MODEL_SETTINGS_STORAGE_KEY = "intro-builder.agent.model-settings.v1";
const AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY =
  "intro-builder.agent.model-api-key.v1";

export function AgentPanel({
  resumeId,
  title,
  templateId,
  getResumeContent,
  completeness,
  applyOperation,
  flushAutosave,
  onBackToEdit,
  defaultAutoApply = false,
  lockAutoApply = false,
  showBackButton = true,
  surface = "panel",
}: {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
  onBackToEdit?: () => void;
  defaultAutoApply?: boolean;
  lockAutoApply?: boolean;
  showBackButton?: boolean;
  surface?: AgentPanelSurface;
}) {
  const [turnArtifacts, setTurnArtifacts] = useState<AgentTurnArtifacts[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contextStatus, setContextStatus] =
    useState<AgentContextStatusSnapshot | null>(null);
  const [resumeWorkspace, setResumeWorkspace] =
    useState<AgentResumeWorkspaceSnapshot | null>(null);
  const [modelSettings, setModelSettings] = useState<AgentModelSettingsForm>(
    () => emptyModelSettings(),
  );
  const [threadKey, setThreadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [autoApply, setAutoApply] = useState(() => {
    if (lockAutoApply) return true;
    return defaultAutoApply;
  });
  const [lastRetryRequest, setLastRetryRequest] = useState<AgentRetryRequest | null>(
    null,
  );
  const activeTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModelSettings(readStoredModelSettings());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (lockAutoApply) {
        setAutoApply(true);
        return;
      }
      const stored = window.localStorage.getItem("intro-builder.agent.auto-apply.v1");
      if (stored === "true" || stored === "false") {
        setAutoApply(stored === "true");
        return;
      }
      setAutoApply(defaultAutoApply);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultAutoApply, lockAutoApply]);

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
      operations: mergeResumeOperations(
        turn.operations,
        toolResult.proposedOperations,
      ),
      status:
        toolResult.proposedOperations.length > 0
          ? "waiting-confirmation"
          : "complete",
    }));
  }

  function appendWorkspaceOperations(
    workspace: AgentResumeWorkspaceSnapshot,
    turnId = activeTurnIdRef.current,
  ) {
    const operations = getPendingWorkspaceOperations(workspace);
    if (operations.length === 0) return;

    updateAgentTurn(turnId, (turn) => {
      const nextOperations = mergeResumeOperations(turn.operations, operations);
      if (nextOperations.length === turn.operations.length) return turn;

      return {
        ...turn,
        operations: nextOperations,
        status: "waiting-confirmation",
      };
    });
  }

  function handleResumeWorkspace(workspace: AgentResumeWorkspaceSnapshot) {
    setResumeWorkspace(workspace);
    appendWorkspaceOperations(workspace);
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
        status: allOperationsApplied
          ? getQuestionInterrupts(turn.interrupts).length > 0
            ? "awaiting-input"
            : "applied"
          : "waiting-confirmation",
      };
    });
  }

  function handleAutoAcceptOperation(operation: ResumeOperation) {
    const turnId = activeTurnIdRef.current;
    applyOperation(operation);
    if (turnId) {
      markOperationApplied(turnId, operation.id);
    }
  }

  function startNewThread() {
    setTurnArtifacts([]);
    setError(null);
    setContextStatus(null);
    setResumeWorkspace(null);
    setIsLoading(false);
    setLastRetryRequest(null);
    setThreadKey((k) => k + 1);
  }

  const isFloatingSurface = surface === "floating";

  return (
    <section
      data-agent-runtime-mode="ag-ui"
      aria-label={`简历对话：${title || "未命名简历"}`}
      className="flex h-full min-h-[480px] flex-col bg-background"
    >
      <AgentAgUiRuntimeProvider
        key={threadKey}
        getIntroBuilderForwardedProps={(intent) => {
          const modelConfig = toAgentModelConfig(modelSettings);
          if (intent.mode === "create_from_zero") {
            return {
              resumeId: null,
              mode: "create_from_zero",
              locale: "zh-CN",
              workflowId: "create-from-zero",
              context: null,
              ...(modelConfig ? { modelConfig } : {}),
            };
          }

          return {
            resumeId,
            locale: "zh-CN",
            workflowId: intent.workflowId,
            context: buildAgentResumeContext({
              content: getResumeContent(),
              templateId,
              activeSection: null,
              completeness,
            }),
            ...(modelConfig ? { modelConfig } : {}),
          };
        }}
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
        onContextStatus={setContextStatus}
        onResumeWorkspace={handleResumeWorkspace}
        onToolResult={appendToolResult}
        onInterrupts={setAgentTurnInterrupts}
        autoAccept={autoApply}
        onOperationApplied={autoApply ? handleAutoAcceptOperation : undefined}
      >
        {isFloatingSurface ? (
          <AgentFloatingHeader
            title={title}
            modelSettings={modelSettings}
            onNewThread={startNewThread}
            onSaveModelSettings={setModelSettings}
          />
        ) : (
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
            <div className="flex min-w-0 items-center gap-1">
              {showBackButton ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="返回编辑"
                  onClick={onBackToEdit}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : null}
              <AgentThreadDropdown
                resumeId={resumeId}
                title={title}
                modelSettings={modelSettings}
                onNewThread={startNewThread}
              />
            </div>
            <div className="flex items-center gap-2">
              <AgentModelSettingsDialog
                settings={modelSettings}
                onSave={setModelSettings}
              />
            </div>
          </div>
        )}

        <AgentThreadArea
          surface={surface}
          turnArtifacts={turnArtifacts}
          error={error}
          resumeWorkspace={resumeWorkspace}
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
        <AgentComposer contextStatus={contextStatus} isLoading={isLoading} />
        <AgentStatusFooter
          modelName={modelSettings.modelName || "连接模型"}
          autoApply={autoApply}
          onAutoApplyChange={setAutoApply}
          autoApplyLocked={lockAutoApply}
          contextStatus={contextStatus}
        />
      </AgentAgUiRuntimeProvider>
    </section>
  );
}

function AgentFloatingHeader({
  title,
  modelSettings,
  onNewThread,
  onSaveModelSettings,
}: {
  title: string;
  modelSettings: AgentModelSettingsForm;
  onNewThread: () => void;
  onSaveModelSettings: (settings: AgentModelSettingsForm) => void;
}) {
  const messageCount = useAuiState((state) => state.thread.messages.length);
  const displayName = title || "未命名简历";

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b bg-background/95 px-3 backdrop-blur dark:bg-background/90">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            AI 简历助手
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {displayName}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="历史对话"
              />
            }
          >
            <Clock3 className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-3">
            <p className="text-xs font-medium text-foreground">当前对话</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {displayName} · {messageCount} 条消息
              {modelSettings.modelName ? ` · ${modelSettings.modelName}` : ""}
            </p>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="新对话"
          onClick={onNewThread}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <AgentModelSettingsDialog
          settings={modelSettings}
          onSave={onSaveModelSettings}
        />
      </div>
    </div>
  );
}

function AgentModelSettingsDialog({
  settings,
  onSave,
}: {
  settings: AgentModelSettingsForm;
  onSave: (settings: AgentModelSettingsForm) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AgentModelSettingsForm>(settings);

  function openDialog(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraft(settings);
    }
  }

  function saveSettings() {
    const next = normalizeModelSettings(draft);
    storeModelSettings(next);
    onSave(next);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="模型设置"
          />
        }
      >
        <Settings className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
          <DialogDescription>
            为当前浏览器设置本地模型偏好。访问密钥只会随本次对话请求发送。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <AgentModelSettingsField
            id="agent-model-base-url"
            label="模型服务地址"
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(value) => setDraft((current) => ({ ...current, baseUrl: value }))}
          />
          <AgentModelSettingsField
            id="agent-model-api-key"
            label="访问密钥"
            value={draft.apiKey}
            type="password"
            placeholder="只保存在当前浏览器"
            onChange={(value) => setDraft((current) => ({ ...current, apiKey: value }))}
          />
          <div className="space-y-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <AgentModelSettingsField
                  id="agent-model-name"
                  label="模型名称"
                  value={draft.modelName}
                  placeholder="gpt-5-mini"
                  onChange={(value) => setDraft((current) => ({ ...current, modelName: value }))}
                />
              </div>
              <AgentModelFetchButton
                baseUrl={draft.baseUrl}
                apiKey={draft.apiKey}
                onSelectModel={(modelId) =>
                  setDraft((current) => ({ ...current, modelName: modelId }))
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="button" onClick={saveSettings}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentModelSettingsField({
  id,
  label,
  value,
  type = "text",
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  type?: "text" | "password";
  placeholder: string;
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
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}

function AgentThreadArea({
  surface,
  turnArtifacts,
  error,
  resumeWorkspace,
  lastRetryRequest,
  isLoading,
  onDismissError,
  onRetryStarted,
  onInterruptResolved,
  onOperationApplied,
  applyOperation,
  flushAutosave,
}: {
  surface: AgentPanelSurface;
  turnArtifacts: AgentTurnArtifacts[];
  error: string | null;
  resumeWorkspace: AgentResumeWorkspaceSnapshot | null;
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
        className={[
          "h-full overflow-y-auto",
          surface === "floating" ? "space-y-4 px-4 py-4" : "space-y-4 px-4 py-3",
        ].join(" ")}
        autoScroll
      >
        {isEmpty ? (
          <AgentWelcomeSuggestions />
        ) : null}
        <AgentResumeWorkspaceStatus workspace={resumeWorkspace} />
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <AgentThreadMessage
              surface={surface}
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

function AgentResumeWorkspaceStatus({
  workspace,
}: {
  workspace: AgentResumeWorkspaceSnapshot | null;
}) {
  const pendingChangeSets = getPendingWorkspaceChangeSets(workspace);
  const operationCount = pendingChangeSets.reduce(
    (total, changeSet) => total + changeSet.operationIds.length,
    0,
  );

  if (workspace?.mode === "create_from_zero" && workspace.draftResume) {
    const draftStatus =
      operationCount > 0
        ? `待确认 ${operationCount} 条修改`
        : workspace.draftResume.missingFacts.length > 0
          ? "草稿信息待补充"
          : "等待生成写入建议";

    return (
      <div
        role="status"
        aria-live="polite"
        className="ml-1 inline-flex max-w-[85%] items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-950/30 dark:text-emerald-200"
      >
        <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">已生成简历草稿</span>
        <span className="text-emerald-800/80 dark:text-emerald-200/80">
          {draftStatus}
        </span>
      </div>
    );
  }

  if (pendingChangeSets.length === 0 || operationCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="ml-1 inline-flex max-w-[85%] items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow-sm dark:border-amber-400/20 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <Clock3 className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">
        待确认 {pendingChangeSets.length} 组修改
      </span>
      <span className="text-amber-800/80 dark:text-amber-200/80">
        包含 {operationCount} 条建议
      </span>
    </div>
  );
}

function getPendingWorkspaceChangeSets(
  workspace: AgentResumeWorkspaceSnapshot | null,
) {
  return (
    workspace?.changeSets.filter(
      (changeSet) =>
        changeSet.status === "staged" ||
        changeSet.status === "partially_applied",
    ) ?? []
  );
}

function getPendingWorkspaceOperations(
  workspace: AgentResumeWorkspaceSnapshot,
): ResumeOperation[] {
  return getPendingWorkspaceChangeSets(workspace).flatMap(
    (changeSet) => changeSet.operations,
  );
}

function mergeResumeOperations(
  current: ResumeOperation[],
  incoming: ResumeOperation[],
) {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((operation) => operation.id));
  const next = incoming.filter((operation) => {
    if (seen.has(operation.id)) return false;
    seen.add(operation.id);
    return true;
  });
  return next.length > 0 ? [...current, ...next] : current;
}

function AgentWelcomeSuggestions() {
  const threadRuntime = useThreadRuntime();

  function startCreateFromZero() {
    threadRuntime.append({
      role: "user",
      content: [{ type: "text", text: "从 0 帮我做一份简历" }],
      runConfig: {
        custom: {
          mode: "create_from_zero",
          workflowId: "create-from-zero",
        },
      },
    });
  }

  return (
    <div className="flex min-h-[360px] flex-col justify-end px-3 pb-10 pt-24">
      <div className="max-w-md">
        <p className="text-3xl font-semibold leading-tight text-foreground">你好。</p>
        <p className="mt-2 text-2xl leading-tight text-muted-foreground">
          想怎么优化这份简历？
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startCreateFromZero}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:border-sky-300 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/20 dark:hover:border-sky-400/40"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            从 0 创建简历
          </button>
          {AGENT_WELCOME_SUGGESTIONS.map((suggestion) => (
            <ThreadPrimitive.Suggestion
              key={suggestion.label}
              prompt={suggestion.prompt}
              send
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:border-sky-300 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/20 dark:hover:border-sky-400/40"
            >
              {suggestion.label}
            </ThreadPrimitive.Suggestion>
          ))}
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
  const allApprovalInterruptsDecided = approvalInterrupts.every((interrupt) =>
    decisions.has(interrupt.id),
  );
  const approvalResponses = buildApprovalInterruptResponses(
    approvalInterrupts,
    decisions,
  );
  const questionBlockedReason =
    approvalInterrupts.length > 0 && !allApprovalInterruptsDecided
      ? "请先应用或忽略本轮修改建议，再继续分析。"
      : null;

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

    // If a question is also open, submit all interrupt responses together from
    // the question card; AG-UI rejects partial interrupt responses.
    if (
      questionInterrupts.length === 0 &&
      approvalInterrupts.every((interrupt) => newDecisions.has(interrupt.id))
    ) {
      await submitAllDecisions(newDecisions);
    }
  }

  async function handleRejectOperation(operationId: string) {
    if (!hasApprovalInterrupts) return;

    const newDecisions = new Map(decisions);
    const operation = turnArtifact.operations.find((op) => op.id === operationId);
    const decisionId = operation
      ? getApprovalInterruptDecisionId(approvalInterrupts, operation)
      : operationId;
    newDecisions.set(decisionId, false);
    setDecisions(newDecisions);

    if (
      questionInterrupts.length === 0 &&
      approvalInterrupts.every((interrupt) => newDecisions.has(interrupt.id))
    ) {
      await submitAllDecisions(newDecisions);
    }
  }

  async function submitAllDecisions(allDecisions: Map<string, boolean>) {
    if (!submitInterrupts || !hasApprovalInterrupts) return;

    try {
      const responses = buildApprovalInterruptResponses(
        approvalInterrupts,
        allDecisions,
      );
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
    if (questionInterrupts.length === 0) {
      await submitAllDecisions(allApproved);
    }
  }

  async function handleRejectAll() {
    if (!hasApprovalInterrupts) return;

    const allRejected = new Map(
      approvalInterrupts.map((interrupt) => [interrupt.id, false])
    );
    setDecisions(allRejected);
    if (questionInterrupts.length === 0) {
      await submitAllDecisions(allRejected);
    }
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
            已完成 {turnArtifact.toolCalls.length} 个动作
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
            additionalResponses={approvalResponses}
            blockedReason={questionBlockedReason}
            onResolved={() => onInterruptResolved(turnArtifact.id)}
          />
        </div>
      ) : null}
      {turnArtifact.operations.length > 0 ? (
        <div className="space-y-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {countPendingOperations(turnArtifact) === 0
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
  const hasQuestionInterrupts =
    getQuestionInterrupts(turnArtifact.interrupts).length > 0;
  const isRunning =
    turnArtifact.status === "reading" || turnArtifact.status === "generating";
  const Icon =
    turnArtifact.status === "applied" && !hasQuestionInterrupts
      ? CheckCircle2
      : turnArtifact.status === "waiting-confirmation" ||
          turnArtifact.status === "awaiting-input" ||
          hasQuestionInterrupts
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
  additionalResponses = [],
  blockedReason,
  onResolved,
}: {
  interrupts: AgentAgUiInterrupt[];
  additionalResponses?: readonly AgentInterruptResponse[];
  blockedReason?: string | null;
  onResolved: () => void;
}) {
  const submitInterrupts = useAgentAgUiInterruptSubmit();
  const threadRuntime = useThreadRuntime();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  if (interrupts.length === 0) return null;

  const allAnswered = interrupts.every(
    (interrupt) => (answers[interrupt.id] ?? "").trim() !== "",
  );
  const canSubmit = allAnswered && !blockedReason;

  function updateAnswer(interruptId: string, value: string) {
    setAnswers((current) => ({ ...current, [interruptId]: value }));
  }

  async function submitAnswer() {
    if (!canSubmit || isSubmitting) return;

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      if (submitInterrupts) {
        await submitInterrupts(
          [
            ...additionalResponses,
            ...interrupts.map((interrupt) => ({
              interruptId: interrupt.id,
              status: "resolved" as const,
              payload: { answer: (answers[interrupt.id] ?? "").trim() },
            })),
          ],
        );
      } else {
        await threadRuntime.append({
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "补充信息：",
                ...interrupts.map(
                  (interrupt) =>
                    `${interrupt.message ?? interrupt.id}：${(answers[interrupt.id] ?? "").trim()}`,
                ),
              ].join("\n"),
            },
          ],
        });
      }
      onResolved();
      setAnswers({});
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
          <div className="mt-3 space-y-2">
            {interrupts.map((interrupt, index) => {
              const question =
                interrupt.message ??
                (interrupts.length > 1
                  ? `请补充第 ${index + 1} 个关键信息。`
                  : "请补充一个关键信息，Agent 会继续当前任务。");
              const inputId = `agent-question-answer-${interrupt.id}`;

              return (
                <div key={interrupt.id} className="space-y-1.5">
                  <label
                    htmlFor={inputId}
                    className="block text-xs font-medium text-muted-foreground"
                  >
                    {question}
                  </label>
                  <textarea
                    id={inputId}
                    aria-label={question}
                    value={answers[interrupt.id] ?? ""}
                    onChange={(event) =>
                      updateAnswer(interrupt.id, event.target.value)
                    }
                    rows={interrupts.length > 1 ? 2 : 3}
                    className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={
                      index === 0
                        ? "例如：增长型前端工程师，偏数据看板和投放平台"
                        : "补充真实信息，避免编造"
                    }
                  />
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {blockedReason ??
                  "只会作为本轮 Agent 上下文，不会直接写入简历。"}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit || isSubmitting}
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
  surface,
  message,
  turnArtifact,
  onInterruptResolved,
  onOperationApplied,
  applyOperation,
  flushAutosave,
}: {
  surface: AgentPanelSurface;
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
          surface === "floating" ? (
            <MessagePrimitive.Root className="group/message relative z-0 flex items-start gap-2 pb-5 text-left hover:z-20 focus-within:z-20">
              <div
                data-testid="agent-assistant-avatar"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 shadow-sm ring-1 ring-sky-200/70 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-400/20"
              >
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0 max-w-[82%]">
                <div
                  data-testid="agent-assistant-message-bubble"
                  className="inline-block rounded-2xl rounded-tl-md border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-sm dark:border-border dark:bg-muted/20"
                >
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
              </div>
            </MessagePrimitive.Root>
          ) : (
            <MessagePrimitive.Root className="group/message relative z-0 pb-8 text-left hover:z-20 focus-within:z-20">
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
          )
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
    <MessagePrimitive.Root
      className={[
        "group/message relative z-0 hover:z-20 focus-within:z-20",
        surface === "floating"
          ? "flex flex-row-reverse items-start gap-2 pb-5 text-right"
          : "pb-8 text-right",
      ].join(" ")}
    >
      <AgentUserMessageBody text={text} surface={surface} />
    </MessagePrimitive.Root>
  );
}

function AgentUserMessageBody({
  text,
  surface,
}: {
  text: string;
  surface: AgentPanelSurface;
}) {
  const isEditing = useEditComposer((state) => state.isEditing);

  if (isEditing) {
    return <AgentEditMessageComposer />;
  }

  if (surface === "floating") {
    return (
      <>
        <div
          data-testid="agent-user-avatar"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background shadow-sm"
        >
          我
        </div>
        <div className="min-w-0 max-w-[82%]">
          <div className="inline-block whitespace-pre-wrap rounded-2xl rounded-tr-md bg-foreground px-3.5 py-2.5 text-sm text-background shadow-sm">
            {text}
          </div>
          <AgentUserMessageActions />
        </div>
      </>
    );
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
  const editRuntime = useMessageRuntime({ optional: true })?.composer;
  const state = useEditComposer();
  const [text, setText] = useState(state.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync textarea height with content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !editRuntime) return;
    const originalText = state.text.trim();
    editRuntime.setText(trimmed);
    if (trimmed === originalText) {
      editRuntime.send({ startRun: true });
      return;
    }
    editRuntime.send();
  };

  const handleCancel = () => {
    editRuntime?.cancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className="ml-auto max-w-[85%] rounded-xl border border-sky-200/80 bg-background p-2 text-left shadow-sm dark:border-sky-400/20">
      <textarea
        ref={textareaRef}
        data-testid="agent-edit-message-input"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className="min-h-16 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          aria-label="取消编辑"
          onClick={handleCancel}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground shadow-sm hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
          取消
        </button>
        <button
          type="button"
          aria-label="保存并重新发送"
          onClick={handleSend}
          disabled={!text.trim()}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-600 px-2 text-xs font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          保存并重新发送
        </button>
      </div>
    </div>
  );
}

function AgentAssistantMessageActions() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="pointer-events-none absolute bottom-0 left-0 z-30 flex max-w-[85%] gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
    >
      <ActionBarPrimitive.Copy
        aria-label="复制回答"
        copiedDuration={1600}
        className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[copied=true]:bg-emerald-50 data-[copied=true]:text-emerald-700 dark:bg-background/90 dark:hover:bg-muted/50 dark:data-[copied=true]:bg-emerald-950/30 dark:data-[copied=true]:text-emerald-300"
      >
        <Copy className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload
        aria-label="重新生成回答"
        className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:bg-background/90 dark:hover:bg-muted/50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function AgentUserMessageActions() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="never"
      autohideFloat="never"
      className="pointer-events-none absolute bottom-0 right-0 z-30 flex max-w-[85%] justify-end gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
    >
      <ActionBarPrimitive.Copy
        aria-label="复制消息"
        copiedDuration={1600}
        className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[copied=true]:bg-emerald-50 data-[copied=true]:text-emerald-700 dark:bg-background/90 dark:hover:bg-muted/50 dark:data-[copied=true]:bg-emerald-950/30 dark:data-[copied=true]:text-emerald-300"
      >
        <Copy className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Edit
        aria-label="编辑消息"
        className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:bg-background/90 dark:hover:bg-muted/50"
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
        Agent 正在处理
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
  const actionLabel = agentActionLabel(toolName);

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
          {isWaitingForAction ? "等待你确认" : actionLabel}
        </span>
      </div>
      <p className="mt-1 text-sky-700/80 dark:text-sky-200/80">
        处理结果会先展示给你；涉及简历修改时，确认前不会写入表单。
      </p>
    </div>
  );
}

function agentActionLabel(toolName: string): string {
  if (toolName === "resume_read") return "正在读取简历";
  if (toolName === "resume_update_section") return "正在生成修改建议";
  if (toolName === "resume_delete_section") return "正在准备修改建议";
  if (toolName === "resume_reorder_sections") return "正在整理模块顺序";
  if (toolName === "resume_insert_section") return "正在准备新增内容";
  return "正在整理上下文";
}

function AgentMarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="space-y-2 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_strong]:font-semibold [&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:border [&_th]:border-border/60 [&_th]:bg-background/60 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
      components={{
        table: AgentMarkdownTable,
      }}
      remarkPlugins={[remarkGfm]}
      smooth
    />
  );
}

function AgentMarkdownTable({
  node: _node,
  className,
  ...props
}: React.ComponentProps<"table"> & { node?: unknown }) {
  void _node;
  return (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border/70">
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

function AgentComposer({
  contextStatus,
  isLoading,
}: {
  contextStatus: AgentContextStatusSnapshot | null;
  isLoading: boolean;
}) {
  return (
    <ComposerPrimitive.Root
      data-testid="agent-assistant-ui-composer"
      className="shrink-0 border-t bg-muted/40 p-3 dark:bg-muted/20"
    >
      <div
        data-testid="agent-assistant-ui-composer-shell"
        className="rounded-2xl border border-border bg-muted/40 px-3 py-2 shadow-sm transition focus-within:border-sky-500 focus-within:bg-muted/40 focus-within:ring-2 focus-within:ring-sky-500/15 dark:border-input dark:bg-muted/20 dark:focus-within:bg-muted/20"
      >
        <ComposerPrimitive.Input
          data-testid="agent-assistant-ui-composer-input"
          rows={2}
          submitMode="enter"
          disabled={isLoading}
          placeholder="输入消息，Enter 发送"
          autoComplete="off"
          className="max-h-32 min-h-14 w-full resize-none border-0 !bg-transparent px-1 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          {isLoading ? (
            <ComposerPrimitive.Cancel
              aria-label="停止生成"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-200/80 bg-sky-50 text-sky-800 shadow hover:bg-sky-100 disabled:pointer-events-none disabled:opacity-50 dark:border-sky-400/20 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span className="sr-only">停止生成</span>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send
              aria-label="发送"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white shadow hover:bg-sky-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">发送</span>
            </ComposerPrimitive.Send>
          )}
        </div>
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
  if (getQuestionInterrupts(turnArtifact.interrupts).length > 0) {
    return "等待补充信息";
  }
  if (turnArtifact.status === "applied") return "已应用";
  if (countPendingOperations(turnArtifact) > 0) return "等待确认修改";
  if (turnArtifact.status === "reading") {
    return "正在读取简历上下文";
  }
  if (turnArtifact.status === "generating") return "正在生成修改建议";
  if (turnArtifact.toolCalls.length > 0) return "已完成动作";
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

function buildApprovalInterruptResponses(
  approvalInterrupts: AgentAgUiInterrupt[],
  decisions: Map<string, boolean>,
): AgentInterruptResponse[] {
  return approvalInterrupts
    .filter((interrupt) => decisions.has(interrupt.id))
    .map((interrupt) => {
      const approved = decisions.get(interrupt.id) === true;
      return {
        interruptId: interrupt.id,
        status: approved ? ("resolved" as const) : ("cancelled" as const),
        payload: { approved },
      };
    });
}

function readStoredModelSettings(): AgentModelSettingsForm {
  if (typeof window === "undefined") return emptyModelSettings();
  try {
    const raw = window.localStorage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const storedApiKey = readSessionModelApiKey();
    if (!isRecord(parsed)) {
      return { ...emptyModelSettings(), apiKey: storedApiKey };
    }
    const legacyApiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    const apiKey = storedApiKey || legacyApiKey;
    if (legacyApiKey) {
      storeModelSettings({
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        modelName: typeof parsed.modelName === "string" ? parsed.modelName : "",
        apiKey,
      });
    }
    return normalizeModelSettings({
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey,
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
    AGENT_MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      baseUrl: normalized.baseUrl,
      modelName: normalized.modelName,
    }),
  );
  if (normalized.apiKey) {
    window.sessionStorage.setItem(
      AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY,
      normalized.apiKey,
    );
  } else {
    window.sessionStorage.removeItem(AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY);
  }
}

function readSessionModelApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY) ?? "";
}

function emptyModelSettings(): AgentModelSettingsForm {
  return {
    baseUrl: "",
    apiKey: "",
    modelName: "",
  };
}

function normalizeModelSettings(
  settings: AgentModelSettingsForm,
): AgentModelSettingsForm {
  return {
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
    modelName: settings.modelName.trim(),
  };
}

function toAgentModelConfig(
  settings: AgentModelSettingsForm,
): AgentModelConfig | null {
  const normalized = normalizeModelSettings(settings);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.modelName) {
    return null;
  }
  return normalized;
}


function AgentThreadDropdown({
  resumeId,
  title,
  modelSettings,
  onNewThread,
}: {
  resumeId: string;
  title: string;
  modelSettings: AgentModelSettingsForm;
  onNewThread: () => void;
}) {
  const messageCount = useAuiState((state) => state.thread.messages.length);
  
  const shortThreadId = `resume_${resumeId.slice(0, 8)}`;
  const displayName = title || "未命名简历";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={buttonVariants({
          variant: "ghost",
          size: "sm",
          className: "group/thread max-w-[180px] gap-1.5 px-2 text-sm font-medium",
        })}
      >
        <span className="truncate">{displayName}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread:opacity-100" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 py-1.5">
          <p className="text-xs font-medium text-foreground">{displayName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            会话 · {messageCount} 条消息
            {modelSettings.modelName ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <Bot className="h-3 w-3" />
                {modelSettings.modelName}
              </span>
            ) : null}
          </p>
        </div>
        <DropdownMenuItem
          onClick={onNewThread}
          className="mt-1 cursor-pointer text-xs"
        >
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          开始新对话
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentStatusFooter({
  modelName,
  autoApply,
  onAutoApplyChange,
  autoApplyLocked,
  contextStatus,
}: {
  modelName: string;
  autoApply: boolean;
  onAutoApplyChange: (value: boolean) => void;
  autoApplyLocked: boolean;
  contextStatus: AgentContextStatusSnapshot | null;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t bg-muted/30 px-4 py-1.5 dark:bg-muted/10">
      <div className="flex items-center gap-3">
        {autoApplyLocked ? (
          <span
            title="AI 简历助手会自动应用低风险修改。"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <Zap className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            自动应用
          </span>
        ) : (
          <Popover>
          <PopoverTrigger
            type="button"
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                autoApply
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 dark:bg-muted/30 dark:hover:bg-muted/40",
              ].join(" ")}
            >
              <Zap className={autoApply ? "h-3 w-3 text-emerald-600 dark:text-emerald-400" : "h-3 w-3"} />
              {autoApply ? "自动应用" : "手动确认"}
            </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-3" side="top">
            <p className="text-xs font-medium">Agent 操作模式</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {autoApply
                ? "Agent 的建议将自动应用到简历，无需逐条确认。"
                : "Agent 的建议需要你逐条确认后才会应用到简历。"}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-7 w-full text-xs"
              onClick={() => {
                const next = !autoApply;
                onAutoApplyChange(next);
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(
                    "intro-builder.agent.auto-apply.v1",
                    String(next),
                  );
                }
              }}
            >
              <ArrowUpDown className="mr-1 h-3 w-3" />
              切换为{autoApply ? "手动确认" : "自动应用"}
            </Button>
          </PopoverContent>
        </Popover>
        )}
        <AgentContextIndicator status={contextStatus} className="min-w-0" />
      </div>
      <div className="flex items-center gap-1.5">
        <Bot className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {modelName || "连接模型"}
        </span>
      </div>
    </div>
  );
}


function AgentModelFetchButton({
  baseUrl,
  apiKey,
  onSelectModel,
}: {
  baseUrl: string;
  apiKey: string;
  onSelectModel: (modelId: string) => void;
}) {
  const [isFetching, setIsFetching] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchModels() {
    if (!baseUrl || !apiKey) return;
    setIsFetching(true);
    setFetchError(null);
    setModels(null);

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/models`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const ids = extractModelIds(data);
      if (ids.length === 0) {
        setFetchError("未找到可用模型");
      }
      setModels(ids);
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "获取模型列表失败",
      );
    } finally {
      setIsFetching(false);
    }
  }

  if (models && models.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1 text-xs"
          >
            <Check className="h-3 w-3 text-emerald-600" />
            {models.length} 个模型
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-48 overflow-y-auto">
          {models.map((modelId) => (
            <DropdownMenuItem
              key={modelId}
              onClick={() => onSelectModel(modelId)}
              className="cursor-pointer text-xs"
            >
              {modelId}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-1 text-xs"
        disabled={!baseUrl || !apiKey || isFetching}
        onClick={fetchModels}
      >
        {isFetching ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {isFetching ? "获取中…" : "获取模型"}
      </Button>
      {fetchError ? (
        <p className="text-xs text-destructive">{fetchError}</p>
      ) : null}
    </div>
  );
}

function extractModelIds(data: unknown): string[] {
  if (!isRecord(data)) return [];
  if (Array.isArray(data.data)) {
    return data.data
      .map((item) =>
        isRecord(item) && typeof item.id === "string" ? item.id : null,
      )
      .filter((id): id is string => id !== null);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
