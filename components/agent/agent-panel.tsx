"use client";

import { useState } from "react";
import { EventType, type BaseEvent } from "@ag-ui/core";
import {
  ComposerPrimitive,
  type ChatModelRunOptions,
  ThreadPrimitive,
  type ThreadMessage,
  useAuiState,
  useThreadRuntime,
} from "@assistant-ui/react";
import { ArrowLeft, Loader2, Send } from "lucide-react";

import { AgentConfirmationCard } from "@/components/agent/agent-confirmation-card";
import { AgentPresetWorkflows } from "@/components/agent/agent-preset-workflows";
import { AgentRuntimeProvider } from "@/components/agent/agent-runtime-provider";
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
  const [toolCalls, setToolCalls] = useState<AgentMessageResponse["toolCalls"]>([]);
  const [operations, setOperations] = useState<ResumeOperation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/agent/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          resumeId,
          locale: "zh-CN",
          workflowId: readWorkflowId(runConfig),
          messages: toAgentChatMessages(messages),
          context: buildAgentResumeContext({
            content: getResumeContent(),
            templateId,
            activeSection: null,
            completeness,
          }),
        }),
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
          yield assistantText;
          continue;
        }

        const toolResult = extractAgUiResumeToolResult(event);
        if (toolResult) {
          setToolCalls((current) => [...current, toolResult.toolCall]);
          setOperations((current) => [...current, ...toolResult.proposedOperations]);
        }
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Agent 服务暂不可用");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="flex h-full min-h-[480px] flex-col bg-background">
      <AgentRuntimeProvider sendMessage={sendRuntimeMessage}>
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
            <AgentWorkflowControls disabled={isLoading} />
          </div>
        </div>

        <AgentThreadArea
          toolCalls={toolCalls}
          operations={operations}
          error={error}
          applyOperation={applyOperation}
          flushAutosave={flushAutosave}
        />
        <AgentComposer title={title} isLoading={isLoading} />
      </AgentRuntimeProvider>
    </section>
  );
}

function AgentWorkflowControls({ disabled }: { disabled: boolean }) {
  const threadRuntime = useThreadRuntime();

  return (
    <AgentPresetWorkflows
      disabled={disabled}
      onStart={(workflow) => {
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
  applyOperation,
  flushAutosave,
}: {
  toolCalls: AgentMessageResponse["toolCalls"];
  operations: ResumeOperation[];
  error: string | null;
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
}) {
  const messageCount = useAuiState((state) => state.thread.messages.length);
  const isEmpty = messageCount === 0 && toolCalls.length === 0 && operations.length === 0;

  return (
    <ThreadPrimitive.Root className="min-h-0 flex-1">
      <ThreadPrimitive.Viewport
        data-testid="agent-assistant-ui-thread"
        className="h-full space-y-3 overflow-y-auto p-4"
        autoScroll
      >
        {isEmpty ? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            选择一个预设工作流开始。Agent 会先给出可解释的工具调用和待确认修改建议。
          </div>
        ) : null}
        <ThreadPrimitive.Messages>
          {({ message }) => <AgentThreadMessage message={message} />}
        </ThreadPrimitive.Messages>
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
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function AgentThreadMessage({ message }: { message: ThreadMessage }) {
  const text = readThreadMessageText(message);
  if (!text || message.role === "system") return null;

  return (
    <div className={message.role === "user" ? "text-right" : "text-left"}>
      <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
        {text}
      </div>
    </div>
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
        <ComposerPrimitive.Send
          aria-label="发送"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          <span className="sr-only">发送</span>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
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
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return "Agent 服务暂不可用";
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
