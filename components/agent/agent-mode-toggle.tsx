"use client";

import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AgentModeToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={active}
      aria-label="Agent 模式"
      onClick={onClick}
      className={cn(
        "relative gap-1.5 rounded-full bg-background/90 px-3 text-xs font-semibold shadow-sm shadow-sky-500/10",
        "border-sky-300/50 hover:bg-muted/70 dark:border-sky-400/40 dark:bg-muted/40",
        active && "border-sky-400/70 bg-sky-500/5",
      )}
    >
      <svg aria-hidden className="absolute h-0 w-0">
        <linearGradient id="agent-mode-icon-gradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="55%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </svg>
      <MessageSquare
        className="h-3.5 w-3.5 text-transparent"
        stroke="url(#agent-mode-icon-gradient)"
      />
      <span className="bg-gradient-to-r from-sky-500 via-teal-500 to-amber-500 bg-clip-text text-transparent">
        Agent 模式
      </span>
    </Button>
  );
}
