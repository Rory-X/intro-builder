"use client";

import { useState } from "react";
import { diffWords } from "diff";
import { ChevronDown, ChevronUp } from "lucide-react";

import type {
  AgentOperationApprovalRequest,
  ResumeOperation,
} from "@intro-builder/shared/types";
import { Button } from "@/components/ui/button";

export function AgentConfirmationCard({
  operation,
  status,
  onApply,
  onReject,
}: {
  operation: ResumeOperation;
  status?: AgentOperationApprovalRequest["status"];
  onApply: (operation: ResumeOperation) => void | Promise<void>;
  onReject: (operationId: string) => void;
}) {
  const persistedResolved = resolvedStateForStatus(status);
  const [localResolved, setLocalResolved] = useState<"applied" | "ignored" | null>(null);
  const resolved = persistedResolved ?? localResolved;
  const [showFullText, setShowFullText] = useState(false);

  const changes = diffWords(operation.beforePlainText, operation.afterPlainText);

  return (
    <div className="rounded-lg border bg-background p-3 text-sm shadow-sm">
      <div className="font-medium">{operation.label}</div>
      <p className="mt-1 text-muted-foreground">{operation.changeSummary}</p>

      {showFullText ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-md border bg-red-50/50 p-2 text-xs dark:bg-red-950/20">
            <div className="text-xs font-medium text-red-700 dark:text-red-300">修改前</div>
            <div className="mt-1 whitespace-pre-wrap text-red-900 dark:text-red-100">
              {operation.beforePlainText}
            </div>
          </div>
          <div className="rounded-md border bg-green-50/50 p-2 text-xs dark:bg-green-950/20">
            <div className="text-xs font-medium text-green-700 dark:text-green-300">修改后</div>
            <div className="mt-1 whitespace-pre-wrap text-green-900 dark:text-green-100">
              {operation.afterPlainText}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-muted p-2 text-xs">
          <div className="whitespace-pre-wrap leading-relaxed">
            {changes.map((part, i) => {
              if (part.removed) {
                return (
                  <span
                    key={i}
                    className="bg-red-100 text-red-800 line-through dark:bg-red-950/40 dark:text-red-200"
                  >
                    {part.value}
                  </span>
                );
              }
              if (part.added) {
                return (
                  <span
                    key={i}
                    className="bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200"
                  >
                    {part.value}
                  </span>
                );
              }
              return <span key={i}>{part.value}</span>;
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowFullText(!showFullText)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showFullText ? (
          <>
            <ChevronUp className="h-3 w-3" />
            显示 diff
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" />
            查看完整文本
          </>
        )}
      </button>

      {operation.diagnosis ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            💡 为什么要改？
          </summary>
          <p className="mt-1.5 pl-4 text-muted-foreground leading-relaxed">
            {operation.diagnosis}
          </p>
        </details>
      ) : null}

      {operation.riskFlags.length > 0 ? (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {operation.riskFlags.map((flag) => flag.message).join("；")}
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={resolved !== null}
          onClick={() => {
            const result = onApply(operation);
            if (result && typeof result.then === "function") {
              void result
                .then(() => {
                  setLocalResolved("applied");
                })
                .catch(() => undefined);
              return;
            }
            setLocalResolved("applied");
          }}
        >
          应用
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={resolved !== null}
          onClick={() => {
            onReject(operation.id);
            setLocalResolved("ignored");
          }}
        >
          忽略
        </Button>
      </div>
      {resolved === "applied" ? (
        <p className="mt-2 text-xs text-emerald-600">已应用，等待自动保存。</p>
      ) : null}
      {resolved === "ignored" ? (
        <p className="mt-2 text-xs text-muted-foreground">已忽略这条建议。</p>
      ) : null}
    </div>
  );
}

function resolvedStateForStatus(status?: AgentOperationApprovalRequest["status"]) {
  if (status === "approved") return "applied";
  if (status === "rejected") return "ignored";
  return null;
}

export function AgentQuestionCard({
  question,
  field,
  onSubmit,
}: {
  question: string;
  field?: string;
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!answer.trim()) return;
    setSubmitted(true);
    onSubmit(answer.trim());
  };

  if (submitted) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">已回复</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{question}</p>
        <p className="mt-1 text-sm font-medium">{answer}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
          需要补充
        </span>
        {field ? (
          <span className="font-mono text-xs text-muted-foreground">{field}</span>
        ) : null}
      </div>
      <p className="mt-2 text-sm">{question}</p>
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="输入你的回答..."
          className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" onClick={handleSubmit} disabled={!answer.trim()}>
          回复
        </Button>
      </div>
    </div>
  );
}
