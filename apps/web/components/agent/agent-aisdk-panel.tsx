"use client";

import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import { toast } from "sonner";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  makeAssistantToolUI,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { ResumeOperation } from "@intro-builder/shared/types";

import { Button } from "@/components/ui/button";

/**
 * Agent panel on the AI SDK runtime (assistant-ui `useChatRuntime` over the
 * `/api/agent/chat` UI message stream). AG-UI is no longer the transport.
 *
 * Write tools only stage a preview server-side; "应用更改" pulls the staged
 * operations from `/api/agent/preview` and applies them to the live form via
 * the injected `applyOperation` (which feeds the existing autosave queue).
 */

type AgentAiSdkPanelProps = {
  resumeId: string;
  title: string;
  templateId?: string;
  getResumeContent?: () => ResumeContent;
  completeness?: unknown;
  applyOperation: (operation: ResumeOperation) => boolean | void;
  flushAutosave?: () => void;
  onBackToEdit: () => void;
};

export function AgentAiSdkPanel({
  resumeId,
  title,
  applyOperation,
  flushAutosave,
  onBackToEdit,
}: AgentAiSdkPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/agent/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resumeId, mode: "optimize_existing" }),
        });
        const data = (await res.json()) as { sessionId?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.sessionId) {
          setSessionError(data.error ?? "无法开启会话");
          return;
        }
        setSessionId(data.sessionId);
      } catch {
        if (!cancelled) setSessionError("无法开启会话");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  if (sessionError) {
    return (
      <PanelShell title={title} onBackToEdit={onBackToEdit}>
        <div className="p-4 text-sm text-destructive">{sessionError}</div>
      </PanelShell>
    );
  }

  if (!sessionId) {
    return (
      <PanelShell title={title} onBackToEdit={onBackToEdit}>
        <div className="p-4 text-sm text-muted-foreground">正在开启会话…</div>
      </PanelShell>
    );
  }

  return (
    <AgentAiSdkRuntime resumeId={resumeId} sessionId={sessionId}>
      <PanelShell
        title={title}
        onBackToEdit={onBackToEdit}
        toolbar={
          <ApplyPreviewButton
            sessionId={sessionId}
            applyOperation={applyOperation}
            flushAutosave={flushAutosave}
          />
        }
      >
        <AskUserToolUI />
        <ResumeWriteToolUI />
        <ResumeReadToolUI />
        <ChatThread />
      </PanelShell>
    </AgentAiSdkRuntime>
  );
}

function AgentAiSdkRuntime({
  resumeId,
  sessionId,
  children,
}: {
  resumeId: string;
  sessionId: string;
  children: React.ReactNode;
}) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/agent/chat",
        body: { resumeId, sessionId, mode: "optimize_existing" },
      }),
    [resumeId, sessionId],
  );
  const runtime = useChatRuntime({ transport });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

function PanelShell({
  title,
  toolbar,
  onBackToEdit,
  children,
}: {
  title: string;
  toolbar?: React.ReactNode;
  onBackToEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBackToEdit}>
          返回编辑
        </Button>
        <span className="truncate text-sm font-medium">{title}</span>
        <div className="ml-auto">{toolbar}</div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function ChatThread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
      <ThreadPrimitive.Viewport className="thin-scrollbar flex-1 overflow-y-auto px-3 py-4">
        <ThreadPrimitive.Empty>
          <p className="px-1 text-sm text-muted-foreground">
            和 Agent 描述你的目标岗位与经历，它会把改动先写进预览，确认后再应用。
          </p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>
      <Composer />
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <div className="mb-3 ml-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">
      <MessagePrimitive.Parts />
    </div>
  );
}

function AssistantMessage() {
  return (
    <div className="mb-3 max-w-[85%] rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <MessagePrimitive.Parts />
    </div>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 border-t p-3">
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder="描述你的目标岗位、经历或想改的地方…"
        className="thin-scrollbar max-h-32 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <ComposerPrimitive.Send asChild>
        <Button type="button" size="sm">
          发送
        </Button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

const TOOL_LABELS: Record<string, string> = {
  upsert_section: "写入分区",
  read_resume: "读取简历",
  set_goal: "设定目标",
};

const ResumeWriteToolUI = makeAssistantToolUI<
  { fieldPath?: string; label?: string; changeSummary?: string },
  { ok?: boolean; changeSummary?: string; error?: string }
>({
  toolName: "upsert_section",
  render: ({ args, result }) => (
    <div className="my-1 rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          {TOOL_LABELS.upsert_section}
        </span>
        <span className="font-medium">{args?.label ?? args?.fieldPath ?? "分区"}</span>
        <span className="ml-auto text-xs text-muted-foreground">已写入预览</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {result?.changeSummary ?? args?.changeSummary ?? "更新预览内容"}
      </p>
      {args?.fieldPath ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground/80">{args.fieldPath}</p>
      ) : null}
    </div>
  ),
});

const ResumeReadToolUI = makeAssistantToolUI({
  toolName: "read_resume",
  render: () => (
    <div className="my-1 rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
      {TOOL_LABELS.read_resume}（只读）
    </div>
  ),
});

const AskUserToolUI: FC = makeAssistantToolUI<
  { question: string; field?: string; options?: string[] },
  { answer: string }
>({
  toolName: "ask_user",
  display: "standalone",
  render: ({ args, status, result, addResult }) => {
    if (result?.answer) {
      return (
        <div className="my-1 rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="text-xs text-muted-foreground">已补充：{args.question}</p>
          <p className="mt-1">{result.answer}</p>
        </div>
      );
    }
    const requiresInput = status.type === "requires-action" || status.type === "running";
    return (
      <AskUserForm
        question={args.question}
        options={args.options}
        disabled={!requiresInput}
        onSubmit={(answer) => addResult({ answer })}
      />
    );
  },
});

function AskUserForm({
  question,
  options,
  disabled,
  onSubmit,
}: {
  question: string;
  options?: string[];
  disabled: boolean;
  onSubmit: (answer: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="my-1 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const answer = value.trim();
        if (answer) onSubmit(answer);
      }}
    >
      <p className="font-medium">{question}</p>
      {options && options.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onSubmit(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-2 flex items-end gap-2">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
            placeholder="补充信息…"
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={disabled || !value.trim()}>
            提交
          </Button>
        </div>
      )}
    </form>
  );
}

function ApplyPreviewButton({
  sessionId,
  applyOperation,
  flushAutosave,
}: {
  sessionId: string;
  applyOperation: (operation: ResumeOperation) => boolean | void;
  flushAutosave?: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const apply = useCallback(async () => {
    setApplying(true);
    try {
      const res = await fetch(
        `/api/agent/preview?sessionId=${encodeURIComponent(sessionId)}`,
      );
      const data = (await res.json()) as {
        operations?: ResumeOperation[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "无法读取预览");
        return;
      }
      const operations = data.operations ?? [];
      if (operations.length === 0) {
        toast.info("预览暂无可应用的修改");
        return;
      }
      let applied = 0;
      for (const operation of operations) {
        if (applyOperation(operation)) applied += 1;
      }
      flushAutosave?.();
      if (applied === 0) {
        toast.error("这些修改暂不支持自动应用");
      } else {
        toast.success(`已应用 ${applied} 处修改`);
      }
    } catch {
      toast.error("应用失败，请稍后重试");
    } finally {
      setApplying(false);
    }
  }, [sessionId, applyOperation, flushAutosave]);

  return (
    <Button type="button" size="sm" onClick={apply} disabled={applying}>
      {applying ? "应用中…" : "应用更改"}
    </Button>
  );
}
