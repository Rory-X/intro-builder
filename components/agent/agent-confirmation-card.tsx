"use client";

import { useState } from "react";

import type { ResumePatch } from "@/lib/agent/agent-message-contract";
import { Button } from "@/components/ui/button";

export function AgentConfirmationCard({
  patch,
  onApply,
}: {
  patch: ResumePatch;
  onApply: (patch: ResumePatch) => void;
}) {
  const [resolved, setResolved] = useState<"applied" | "ignored" | null>(null);

  return (
    <div className="rounded-lg border bg-background p-3 text-sm shadow-sm">
      <div className="font-medium">{patch.label}</div>
      <p className="mt-1 text-muted-foreground">{patch.changeSummary}</p>
      <div className="mt-3 rounded-md bg-muted p-2 text-xs">
        <div className="text-muted-foreground">修改后</div>
        <div className="mt-1 whitespace-pre-wrap">{patch.afterPlainText}</div>
      </div>
      {patch.riskFlags.length > 0 ? (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {patch.riskFlags.map((flag) => flag.message).join("；")}
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={resolved !== null}
          onClick={() => {
            onApply(patch);
            setResolved("applied");
          }}
        >
          应用
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={resolved !== null}
          onClick={() => setResolved("ignored")}
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
