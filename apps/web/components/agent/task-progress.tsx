"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Loader2, CheckCircle2 } from "lucide-react";

import type { TaskCard, TaskStep } from "@/lib/ai-client/task-projection";
import { taskCardHeadline } from "@/lib/ai-client/task-projection";

/**
 * 任务卡（P06 任务 2 的 UI 接线）。
 *
 * 消费 `lib/ai-client/task-projection.ts` 的投影 —— 该模块保证「不虚构进度」、
 * 「完成与保存分开」。本组件只负责展示，**不重新判断**这些：
 * 一旦在这里写 `status === "done" ? "已保存" : ...`，投影层的约束就失效了。
 *
 * ## 两条与 plan 直接对应的行为
 *
 * - **长任务可以折叠，用户滚走时不强制拉回底部**：折叠状态由本组件持有，
 *   且**不**在步骤增加时自动展开（那会把用户滚走的视图拉回来）。
 * - **失败/中断时不留转圈的步骤**：投影层已把未完成步骤标为 failed，
 *   这里只是如实渲染它的 `detail`。
 */

function stepIcon(step: TaskStep) {
  switch (step.status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
    case "failed":
      return <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />;
    case "waiting":
      return <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
    default:
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
}

export function TaskProgressCard({
  card,
  defaultCollapsed = false,
}: {
  card: TaskCard;
  /** 初始折叠状态。默认展开 —— 用户主动折叠后才收起。 */
  defaultCollapsed?: boolean;
}) {
  /*
   * 折叠状态只在这里持有，且**不随 card.steps.length 变化而变化**。
   *
   * plan 要求「用户滚走时不强制拉回底部」：若折叠状态被步骤数变化重置，
   * 用户折叠后一旦有新步骤就会重新展开 —— 那正是「强制拉回」的一种形式。
   */
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const headline = taskCardHeadline(card);

  /*
   * 没有可展示的内容时**不渲染任何东西**。
   *
   * 投影层在「running 但无步骤」时返回 null 标题，这里保持一致：
   * 显示一个空卡片比不显示更糟（用户会以为有内容正在加载）。
   */
  if (!headline && card.steps.length === 0) return null;

  const hasSteps = card.steps.length > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {card.status === "running" && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <span className="truncate font-medium">{headline}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 已保存标记由 hasPersistedChanges 决定，不由 status 决定。 */}
          {card.hasPersistedChanges && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ 已保存</span>
          )}
          {hasSteps && (
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {card.steps.length} 步
            </button>
          )}
        </div>
      </div>

      {card.pendingQuestion && (
        <p className="mt-2 text-muted-foreground">{card.pendingQuestion.question}</p>
      )}

      {!collapsed && hasSteps && (
        <ul className="mt-2 space-y-1">
          {card.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              <span className="mt-0.5">{stepIcon(step)}</span>
              <span className="min-w-0">
                <span className="text-muted-foreground">{step.label}</span>
                {step.detail && (
                  <span className="ml-1 text-xs text-destructive">{step.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {card.conflictCount > 0 && (
        <p className="mt-2 text-xs text-destructive">
          有 {card.conflictCount} 处修改与你的编辑冲突，需要你确认。
        </p>
      )}
    </div>
  );
}
