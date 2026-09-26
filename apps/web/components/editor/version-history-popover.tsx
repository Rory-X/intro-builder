"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";
import {
  canUndo,
  groupVersionsByTask,
  sourceLabel,
  type VersionGroup,
  type VersionRecord,
} from "@/lib/ai-client/version-history";
import { cn } from "@/lib/utils";

/**
 * 版本历史（P06 任务 5 的 UI 接线）。
 *
 * 消费 `lib/ai-client/version-history.ts` 的 `groupVersionsByTask`：
 * plan 要求「列表**按任务聚合**，展开看各 revision 和 source；
 * **单条记录能回到 task/run**」。
 *
 * ## 聚合解决的实际问题
 *
 * 一次 Agent 任务常常产生多个版本（多个工具各自提交一次）。扁平列表会把它们
 * 渲染成一串看不出关联的记录，用户无法判断「哪几条属于同一次对话」。
 * 聚合后一次任务只有一行，点开才看得到每次提交。
 *
 * ## 为什么不改既有渲染文案
 *
 * 「N 处修改 · 操作人 来源」这行已被既有测试固定下来
 * （`version-history-popover.test.tsx`）。那是用户已经熟悉的表达，
 * 本次改动的目标是**聚合与跳转**，不是重写措辞 —— 因此单条记录的行
 * 与原文逐字一致。
 */

type Props = {
  versions: ResumeVersionListItem[];
  activeVersionId?: string | null;
  isLoading?: boolean;
  onSelectVersion: (versionId: string) => void;
  /** 点击「回到这次对话」时跳转到对应 Run（有 runId 的记录才显示该入口）。 */
  onOpenRun?: (runId: string) => void;
  /**
   * 撤销某个版本。
   *
   * 未传时**不渲染撤销按钮** —— 让用户点一个没接线的按钮比不显示更糟。
   * 仅 `canUndo` 为真的记录才显示（撤销记录本身、无 mutationId、
   * 无主的系统操作都不可撤销）。
   */
  onUndo?: (versionId: string) => void;
};

/**
 * 把读取层的条目转成投影层的记录。
 *
 * 两个类型字段同构（`ResumeVersionListItem` 在 P06 任务 5 补齐了
 * revision/runId/changeSetId/mutationId），因此这里只做**缺失值收敛**：
 * 旧数据或测试构造的对象可能没有这些字段，运行时是 `undefined`，
 * 而投影层期望 `null`。显式收敛比依赖 `undefined` 的判真语义更清楚，
 * 也让既有测试（不传这些字段）不需要改动。
 */
function toRecord(item: ResumeVersionListItem): VersionRecord {
  return {
    id: item.id,
    resumeId: item.resumeId,
    source: item.source,
    actorName: item.actorName,
    operationCount: item.operationCount,
    summary: item.summary,
    createdAt: item.createdAt,
    revision: item.revision ?? null,
    runId: item.runId ?? null,
    changeSetId: item.changeSetId ?? null,
    mutationId: item.mutationId ?? null,
  };
}

/** 一行版本记录（`single` 组与展开后的子项共用）。 */
function VersionRow({
  item,
  active,
  onSelect,
  onUndo,
}: {
  item: VersionRecord;
  active: boolean;
  onSelect: () => void;
  onUndo?: (versionId: string) => void;
}) {
  return (
    <div className={cn("flex items-center gap-2", active && "bg-primary/5")}>
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 px-5 py-3.5 text-left transition-colors hover:bg-accent"
        aria-label={`${formatVersionTime(item.createdAt)}，${item.operationCount} 处修改`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">
            {formatVersionTime(item.createdAt)}
          </span>
          {active ? (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              正在查看
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {item.operationCount} 处修改 · {item.actorName} {sourceLabel(item.source)}
        </div>
      </button>
      {onUndo && canUndo(item) ? (
        <button
          type="button"
          onClick={() => onUndo(item.id)}
          className="mr-3 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`撤销 ${formatVersionTime(item.createdAt)} 的修改`}
        >
          撤销
        </button>
      ) : null}
    </div>
  );
}

/**
 * 一次 Agent 任务的组头 + 可展开的版本列表。
 *
 * 默认**折叠** —— plan 说「展开看各 revision 和 source」，
 * 因此展开是用户主动动作。折叠时显示「N 次提交」，
 * 让用户知道这一行背后有多少内容（不展开也有信息量）。
 */
function TaskGroup({
  group,
  activeVersionId,
  onSelectVersion,
  onOpenRun,
  onUndo,
}: {
  group: VersionGroup;
  activeVersionId?: string | null;
  onSelectVersion: (versionId: string) => void;
  onOpenRun?: (runId: string) => void;
  onUndo?: (versionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const head = group.versions[0];

  /*
   * 组内出现撤销记录时给出提示。
   *
   * 必要性：撤销会让内容回到之前的样子，用户看到「内容和我记得的不一样」
   * 时需要能确认「是那次撤销」。没有这个标记时，用户只能逐条点开找。
   */
  const sources = group.sources.map((source) => sourceLabel(source));

  return (
    <div className="border-t">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex flex-1 items-center gap-2 px-5 py-3.5 text-left transition-colors hover:bg-accent"
          aria-expanded={expanded}
          aria-label={`${formatVersionTime(head.createdAt)} 的对话，${group.count} 次提交`}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">
                {formatVersionTime(head.createdAt)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {group.count} 次提交
              </span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {sources.join("、")}
              {group.hasUndo ? " · 含撤销" : ""}
            </span>
          </span>
        </button>
        {group.canOpenRun && onOpenRun && group.id ? (
          <button
            type="button"
            onClick={() => onOpenRun(group.id)}
            className="mr-3 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="回到这次对话"
          >
            回到对话
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-border/40 bg-muted/20">
          {group.versions.map((item) => (
            <VersionRow
              key={item.id}
              item={item}
              active={item.id === activeVersionId}
              onSelect={() => onSelectVersion(item.id)}
              onUndo={onUndo}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function VersionHistoryPopover({
  versions,
  activeVersionId,
  isLoading = false,
  onSelectVersion,
  onOpenRun,
  onUndo,
}: Props) {
  /*
   * 聚合在渲染时计算，不用 `useMemo`。
   *
   * 读取层限 50 条，分组是线性扫描 —— 缓存带来的复杂度超过收益。
   */
  const groups = groupVersionsByTask(versions.map(toRecord));

  return (
    <div className="w-80 overflow-hidden rounded-xl border bg-background shadow-lg">
      <div className="px-5 py-4 text-base font-semibold text-foreground">
        版本历史
      </div>
      {isLoading ? (
        <div className="border-t px-5 py-6 text-sm text-muted-foreground">
          正在加载版本历史…
        </div>
      ) : groups.length === 0 ? (
        <div className="border-t px-5 py-6">
          <p className="text-sm font-medium text-foreground">还没有版本记录</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Agent 修改或恢复历史版本后，会在这里留下可对比的记录。
          </p>
        </div>
      ) : (
        <div className="border-t">
          {groups.map((group) =>
            group.kind === "task" ? (
              <TaskGroup
                key={group.id}
                group={group}
                activeVersionId={activeVersionId}
                onSelectVersion={onSelectVersion}
                onOpenRun={onOpenRun}
                onUndo={onUndo}
              />
            ) : (
              <VersionRow
                // 单条记录的组 id 就是版本 id。
                key={group.id}
                item={group.versions[0]}
                active={group.versions[0].id === activeVersionId}
                onSelect={() => onSelectVersion(group.versions[0].id)}
                onUndo={onUndo}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function formatVersionTime(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")} 月 ${get("day")} 日 · ${get("dayPeriod")} ${get("hour")}:${get("minute")}`;
}
