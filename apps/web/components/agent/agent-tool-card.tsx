"use client";

import type { AgentToolCall } from "@intro-builder/shared/types";

const TOOL_ACTION_LABELS: Record<AgentToolCall["name"], string> = {
  resume_read: "读取简历",
  resume_update_section: "更新分区",
  resume_insert_section: "新增分区",
  resume_delete_section: "删除分区",
  resume_reorder_sections: "调整顺序",
};

function toolFieldTarget(input: AgentToolCall["input"]): string | null {
  const fieldPath = input?.["fieldPath"];
  if (typeof fieldPath === "string" && fieldPath.trim()) return fieldPath;
  const section = input?.["section"];
  if (typeof section === "string" && section.trim()) return section;
  return null;
}

/**
 * Renders one loop tool call (assistant-ui tool content-part style): an action
 * chip + the friendly title, the change summary, and the field it touched.
 * Writes only stage the draft; nothing is applied to the real resume here.
 */
export function AgentToolCard({ toolCall }: { toolCall: AgentToolCall }) {
  const action = TOOL_ACTION_LABELS[toolCall.name] ?? "工具调用";
  const target = toolFieldTarget(toolCall.input);

  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          {action}
        </span>
        <span className="font-medium">{toolCall.title}</span>
        <span className="ml-auto text-xs text-muted-foreground">已写入草稿</span>
      </div>
      <p className="mt-1 text-muted-foreground">{toolCall.summary}</p>
      {target ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground/80">{target}</p>
      ) : null}
    </div>
  );
}
