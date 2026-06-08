"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";

import { AgentConfirmationCard } from "@/components/agent/agent-confirmation-card";
import { AgentPresetWorkflows } from "@/components/agent/agent-preset-workflows";
import { AgentToolCard } from "@/components/agent/agent-tool-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type {
  AgentChatMessage,
  AgentMessageResponse,
  AgentResumeContext,
  AgentWorkflowId,
  ResumePatch,
} from "@/lib/agent/agent-message-contract";
import type { ResumeContent } from "@/lib/resume-schema";

export function AgentPanel({
  resumeId,
  title,
  templateId,
  getResumeContent,
  completeness,
  applyPatch,
  flushAutosave,
  onBackToEdit,
}: {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyPatch: (patch: ResumePatch) => void;
  flushAutosave: () => void;
  onBackToEdit: () => void;
}) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<AgentMessageResponse["toolCalls"]>([]);
  const [patches, setPatches] = useState<ResumePatch[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function send(content: string, workflowId: AgentWorkflowId | null) {
    const trimmedContent = content.trim();
    if (!trimmedContent || isLoading) return;

    const userMessage: AgentChatMessage = {
      id: createClientMessageId("user"),
      role: "user",
      content: trimmedContent,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId,
          locale: "zh-CN",
          workflowId,
          messages: nextMessages,
          context: buildAgentResumeContext({
            content: getResumeContent(),
            templateId,
            activeSection: null,
            completeness,
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(readAgentError(data));
      }
      const result = data as AgentMessageResponse;
      setMessages((current) => [...current, result.message]);
      setToolCalls((current) => [...current, ...result.toolCalls]);
      setPatches((current) => [...current, ...result.proposedPatches]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Agent 服务暂不可用");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="flex h-full min-h-[480px] flex-col bg-background">
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
          <AgentPresetWorkflows
            disabled={isLoading}
            onStart={(workflow) => void send(workflow.prompt, workflow.id)}
          />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && toolCalls.length === 0 && patches.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            选择一个预设工作流开始。Agent 会先给出可解释的工具调用和待确认修改建议。
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "text-right" : "text-left"}
          >
            <div className="inline-block max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
              {message.content}
            </div>
          </div>
        ))}
        {toolCalls.map((toolCall) => (
          <AgentToolCard key={toolCall.id} toolCall={toolCall} />
        ))}
        {patches.map((patch) => (
          <AgentConfirmationCard
            key={patch.id}
            patch={patch}
            onApply={(nextPatch) => {
              applyPatch(nextPatch);
              flushAutosave();
            }}
          />
        ))}
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <form
        className="border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const content = input.trim();
          if (!content || isLoading) return;
          setInput("");
          void send(content, null);
        }}
      >
        <div className="flex gap-2">
          <Textarea
            value={input}
            rows={1}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`问问 ${title || "这份简历"} 可以怎么优化`}
            className="min-h-9 flex-1 resize-none"
          />
          <Button type="submit" size="icon" disabled={isLoading || input.trim() === ""}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="sr-only">发送</span>
          </Button>
        </div>
      </form>
    </section>
  );
}

function createClientMessageId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `msg_${prefix}_${crypto.randomUUID()}`;
  }
  return `msg_${prefix}_${Date.now()}`;
}

function readAgentError(value: unknown): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return "Agent 服务暂不可用";
}
