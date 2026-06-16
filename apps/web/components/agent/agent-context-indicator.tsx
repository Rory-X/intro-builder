"use client";

import type { AgentContextStatusSnapshot } from "@intro-builder/shared/types";
import { cn } from "@/lib/utils";

const CONTEXT_INDICATOR_TOOLTIP_CLASS =
  "pointer-events-none invisible absolute bottom-full left-0 z-50 mb-2 w-max max-w-[240px] rounded-md bg-popover px-2.5 py-1.5 text-left text-xs font-medium text-popover-foreground opacity-0 shadow-md ring-1 ring-foreground/10 transition-opacity group-hover/context:visible group-hover/context:opacity-100 group-focus-within/context:visible group-focus-within/context:opacity-100";

export function AgentContextIndicator({
  status,
  className,
}: {
  status: AgentContextStatusSnapshot | null;
  className?: string;
}) {
  if (!status) {
    return (
      <span
        role="status"
        aria-label="上下文状态：待更新"
        tabIndex={0}
        data-testid="agent-context-indicator"
        data-tooltip="上下文用量待更新"
        className={cn(
          "group/context relative inline-flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-full transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span
          aria-hidden="true"
          data-testid="agent-context-indicator-tooltip"
          className={CONTEXT_INDICATOR_TOOLTIP_CLASS}
        >
          上下文用量待更新
        </span>
        <span
          aria-hidden="true"
          data-testid="agent-context-status-ring"
          className="block h-4 w-4 rounded-full border-2 border-muted-foreground/45 bg-transparent ring-2 ring-muted-foreground/10"
        />
      </span>
    );
  }

  const label = contextStatusLabel(status.status);
  const percent = Math.max(0, Math.min(999, Math.round(status.utilization * 100)));
  const ringPercent = Math.max(0, Math.min(100, percent));
  const ringStyle = {
    background: `conic-gradient(${contextStatusColor(status.status)} ${ringPercent}%, rgba(148, 163, 184, 0.24) 0)`,
  };
  const usedTokens = Math.max(
    0,
    Math.round(status.usedInputTokens || status.effectiveInputBudgetTokens * status.utilization),
  );
  const windowLabel = formatTokenAmount(status.effectiveInputBudgetTokens);
  const usedLabel = formatTokenAmount(usedTokens);
  const shortLabel = contextStatusShortLabel(status.status);

  const tooltip = `上下文用量 ${percent}% · 已用约 ${usedLabel} / ${windowLabel} · 状态：${shortLabel}`;

  return (
    <span
      role="status"
      aria-label={`上下文状态：${label}，约 ${percent}%`}
      tabIndex={0}
      data-testid="agent-context-indicator"
      data-tooltip={tooltip}
      className={cn(
        "group/context relative inline-flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-full transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-testid="agent-context-indicator-tooltip"
        className={CONTEXT_INDICATOR_TOOLTIP_CLASS}
      >
        <span className="block">上下文用量 {percent}%</span>
        <span className="mt-0.5 block text-muted-foreground">
          已用约 {usedLabel} / {windowLabel} · 状态：{shortLabel}
        </span>
      </span>
      <span
        aria-hidden="true"
        data-context-usage={percent}
        data-testid="agent-context-status-ring"
        className="grid h-4 w-4 place-items-center rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        style={ringStyle}
      >
        <span className="h-2 w-2 rounded-full bg-background" />
      </span>
    </span>
  );
}

function contextStatusLabel(status: AgentContextStatusSnapshot["status"]): string {
  if (status === "near_limit") return "上下文接近上限";
  if (status === "compacting") return "正在整理上下文";
  if (status === "blocked") return "上下文不足";
  return "上下文充足";
}

function contextStatusShortLabel(status: AgentContextStatusSnapshot["status"]): string {
  if (status === "near_limit") return "接近上限";
  if (status === "compacting") return "整理中";
  if (status === "blocked") return "不足";
  return "充足";
}

function contextStatusColor(status: AgentContextStatusSnapshot["status"]): string {
  if (status === "near_limit") return "#f59e0b";
  if (status === "compacting") return "#0ea5e9";
  if (status === "blocked") return "#ef4444";
  return "#10b981";
}

function formatTokenAmount(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}
