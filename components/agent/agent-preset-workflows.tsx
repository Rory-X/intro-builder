"use client";

import type { AgentWorkflowId } from "@/lib/agent/agent-message-contract";
import { Button } from "@/components/ui/button";

const WORKFLOWS: Array<{
  id: AgentWorkflowId;
  label: string;
  prompt: string;
}> = [
  {
    id: "resume-diagnose",
    label: "诊断整份简历",
    prompt: "请诊断这份简历，并优先指出最值得修改的一处。",
  },
  {
    id: "target-role-match",
    label: "目标岗位匹配",
    prompt: "请根据目标岗位检查这份简历的匹配度；如果缺少目标岗位，请先问我。",
  },
  {
    id: "experience-star",
    label: "经历 STAR 优化",
    prompt: "请帮我按 STAR 原则优化一段经历；如果需要选择经历，请先问我。",
  },
  {
    id: "pre-export-check",
    label: "终检导出前检查",
    prompt: "请在导出 PDF 前检查内容和格式风险。",
  },
];

export function AgentPresetWorkflows({
  disabled,
  onStart,
}: {
  disabled?: boolean;
  onStart: (workflow: { id: AgentWorkflowId; prompt: string }) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {WORKFLOWS.map((workflow) => (
        <Button
          key={workflow.id}
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onStart(workflow)}
        >
          {workflow.label}
        </Button>
      ))}
    </div>
  );
}
