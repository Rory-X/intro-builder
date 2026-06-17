"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import type { AgentToolCall, ResumeOperation } from "@intro-builder/shared/types";
import { Button } from "@/components/ui/button";

const TOOL_TITLES: Record<string, string> = {
  resume_read: "读取简历",
  resume_update_section: "更新分区",
  resume_insert_section: "新增条目",
  resume_delete_section: "删除条目",
  resume_reorder_sections: "重排顺序",
  resume_polish_text: "润色文案",
  resume_set_text: "更新文案",
  resume_ask: "追问用户",
};

type AgentToolCardProps = {
  toolCall: AgentToolCall;
  status?: "running" | "completed" | "applied";
  operations?: ResumeOperation[];
  autoAccept?: boolean;
  onApply?: (operation: ResumeOperation) => void;
  onIgnore?: (operation: ResumeOperation) => void;
};

export function AgentToolCard({
  toolCall,
  status: externalStatus,
  operations = [],
  autoAccept,
  onApply,
  onIgnore,
}: AgentToolCardProps) {
  const isRunning = externalStatus === "running";
  const applied = externalStatus === "applied" || (autoAccept && externalStatus === "completed" && operations.length > 0);

  const borderClass = applied
    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
    : "border-border bg-muted/40";

  return (
    <div className={`rounded-lg border ${borderClass} p-3 text-sm`}>
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : applied ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            {TOOL_TITLES[toolCall.name] ?? "执行动作"}
          </span>
          <span className="truncate font-medium">
            {sanitizeToolCardText(toolCall.title)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {applied && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              ✓ 已应用
            </span>
          )}
          {!applied && !isRunning && (
            <span className="text-xs text-muted-foreground">已写入草稿</span>
          )}
        </div>
      </div>

      <p className="mt-1 text-muted-foreground">
        {sanitizeToolCardText(toolCall.summary)}
      </p>

      {!autoAccept && operations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
          {operations.map((op) => (
            <div key={op.id} className="flex items-center gap-1">
              <Button
                size="sm"
                variant="default"
                onClick={() => onApply?.(op)}
              >
                应用
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onIgnore?.(op)}
              >
                忽略
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const INTERNAL_TOOL_NAME_PATTERN =
  /\b(?:resume_reorder_sections|resume_update_section|resume_delete_section|resume_insert_section|resume_polish_text|resume_set_text|get_completeness|resume_read|resume_ask|set_goal)\b/g;

function sanitizeToolCardText(value: string): string {
  return value.replace(INTERNAL_TOOL_NAME_PATTERN, "内部动作");
}
