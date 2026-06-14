"use client";

import type { AgentToolCall } from "@intro-builder/shared/types";

export function AgentToolCard({ toolCall }: { toolCall: AgentToolCall }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{toolCall.title}</div>
      <p className="mt-1 text-muted-foreground">{toolCall.summary}</p>
    </div>
  );
}
