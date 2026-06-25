"use client";

import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";
import { cn } from "@/lib/utils";

type Props = {
  versions: ResumeVersionListItem[];
  activeVersionId?: string | null;
  isLoading?: boolean;
  onSelectVersion: (versionId: string) => void;
};

export function VersionHistoryPopover({
  versions,
  activeVersionId,
  isLoading = false,
  onSelectVersion,
}: Props) {
  return (
    <div className="w-80 overflow-hidden rounded-xl border bg-background shadow-lg">
      <div className="px-5 py-4 text-base font-semibold text-foreground">
        版本历史
      </div>
      {isLoading ? (
        <div className="border-t px-5 py-6 text-sm text-muted-foreground">
          正在加载版本历史…
        </div>
      ) : versions.length === 0 ? (
        <div className="border-t px-5 py-6">
          <p className="text-sm font-medium text-foreground">还没有版本记录</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Agent 修改或恢复历史版本后，会在这里留下可对比的记录。
          </p>
        </div>
      ) : (
        <div className="border-t">
          {versions.map((version) => {
            const active = version.id === activeVersionId;
            return (
              <button
                key={version.id}
                type="button"
                onClick={() => onSelectVersion(version.id)}
                className={cn(
                  "block w-full px-5 py-3.5 text-left transition-colors hover:bg-accent",
                  active && "bg-primary/5",
                )}
                aria-label={`${formatVersionTime(version.createdAt)}，${version.operationCount} 处修改`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">
                    {formatVersionTime(version.createdAt)}
                  </span>
                  {active ? (
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      正在查看
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {version.operationCount} 处修改 · {version.actorName} {version.sourceLabel}
                </div>
              </button>
            );
          })}
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
