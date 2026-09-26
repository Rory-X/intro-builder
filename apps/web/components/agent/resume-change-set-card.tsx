"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";

import {
  canAcceptIndividually,
  visibleGroups,
  type ChangeCard,
  type ChangeCardGroup,
  type ChangeCardItem,
} from "@/lib/ai-client/change-set-card";
import { Button } from "@/components/ui/button";

/**
 * 提案卡（P06 任务 3 的 UI 接线）。
 *
 * 消费 `lib/ai-client/change-set-card.ts` 的投影。三条 plan 要求落在组件层：
 *
 * 1. **点击定位稳定 itemId**：点击卡片项回调 `onLocate(target)`，
 *    带上投影给的 `{ section, itemId, field }` —— 组件**不**自己从下标推。
 * 2. **冲突组保持可见**：折叠时用 `visibleGroups(card, { collapsed })`，
 *    它只返回有冲突的组。组件不自己写这段过滤逻辑（否则两处规则会漂移）。
 * 3. **允许依赖无关组部分接受**：有依赖的项禁用单项接受按钮
 *    （`canAcceptIndividually`），提示用户「随上一项一起接受」。
 *
 * 另外两处刻意的约束：
 *
 * - **批准 ≠ 已保存**。卡片不显示「已保存」—— 那个事实只能来自提交回执。
 *   组件只表达「可以提交」（`canApply`）。
 * - **生成中不偷改正文**：本组件不发任何写请求，只回调用户意图。
 *   真正的写入由调用方走统一提交路径。
 */

function ItemRow({
  item,
  card,
  selected,
  onToggle,
  onLocate,
}: {
  item: ChangeCardItem;
  card: ChangeCard;
  selected: boolean;
  onToggle: (operationId: string) => void;
  onLocate: (target: ChangeCardItem["target"]) => void;
}) {
  const individuallyAcceptable = canAcceptIndividually(card, item.operationId);
  const conflicted = card.conflicted.includes(item.operationId);

  return (
    <li className="rounded-md border border-border/60 bg-background/60 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            /*
             * 点击标签区域 = 定位到正文。传的是投影给的稳定标识，
             * 不是下标 —— 下标在内容变化后会指向别的条目。
             */
            onClick={() => onLocate(item.target)}
            className="block w-full text-left"
          >
            <span className="font-medium">{item.label}</span>
            <span className="ml-1 text-xs text-muted-foreground">{item.locationLabel}</span>
          </button>

          {(item.before || item.after) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {item.before && <span className="line-through">{item.before}</span>}
              {item.before && item.after && <span className="mx-1">→</span>}
              {item.after && <span>{item.after}</span>}
            </p>
          )}

          {item.rationale && (
            <p className="mt-1 text-xs text-muted-foreground">理由：{item.rationale}</p>
          )}

          {conflicted && (
            <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
              <CircleAlert className="h-3 w-3" />
              这处内容已被别处修改，需要你先确认。
            </p>
          )}

          {!individuallyAcceptable && !conflicted && (
            <p className="mt-1 text-xs text-muted-foreground">
              这一项依赖上面新增的内容，需要一起接受。
            </p>
          )}
        </div>

        <label className="flex shrink-0 items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={selected}
            /*
             * 有依赖的项**禁用**勾选 —— 让用户点出一个必然被服务端拒绝的
             * 组合是更差的体验（服务端有依赖检查，但那是最后一道防线）。
             */
            disabled={!individuallyAcceptable}
            onChange={() => onToggle(item.operationId)}
            aria-label={`接受：${item.label}`}
          />
          接受
        </label>
      </div>
    </li>
  );
}

function GroupBlock({
  group,
  card,
  selected,
  onToggle,
  onLocate,
}: {
  group: ChangeCardGroup;
  card: ChangeCard;
  selected: Set<string>;
  onToggle: (operationId: string) => void;
  onLocate: (target: ChangeCardItem["target"]) => void;
}) {
  return (
    <li
      className={
        group.hasConflict
          ? "rounded-lg border border-destructive/40 bg-destructive/5 p-2"
          : "rounded-lg border border-border/60 p-2"
      }
    >
      {group.hasConflict && (
        <p className="mb-1 text-xs font-medium text-destructive">需要处理的冲突</p>
      )}
      <ul className="space-y-1">
        {group.items.map((item) => (
          <ItemRow
            key={item.operationId}
            item={item}
            card={card}
            selected={selected.has(item.operationId)}
            onToggle={onToggle}
            onLocate={onLocate}
          />
        ))}
      </ul>
    </li>
  );
}

export function ResumeChangeSetCard({
  card,
  onLocate,
  onApply,
  onReject,
}: {
  card: ChangeCard;
  /** 点击卡片项时定位到正文（传稳定 itemId）。 */
  onLocate: (target: ChangeCardItem["target"]) => void;
  /** 应用**选中的**操作。传空数组时调用方应当忽略。 */
  onApply: (operationIds: string[]) => void | Promise<void>;
  onReject: (operationIds: string[]) => void | Promise<void>;
}) {
  /*
   * 选中集合是本组件的本地意图状态，初始为「投影里已接受的操作」。
   *
   * 不在接受后立刻发写请求 —— plan 要求「生成中不偷改正文」，
   * 且批准与落盘是两件事（落盘由调用方的提交路径负责）。
   */
  const [selected, setSelected] = useState<Set<string>>(() => new Set(card.accepted));
  const [collapsed, setCollapsed] = useState(false);

  /*
   * 折叠时用投影给的 `visibleGroups`：**冲突组必须保持可见**。
   * 组件不自己写这段过滤 —— 两处各写一份会漂移，
   * 而漂移的后果是冲突被折叠掉，用户看不到就无法处理。
   */
  const groups = visibleGroups(card, { collapsed });
  const hiddenByCollapse = card.groups.length - groups.length;

  function toggle(operationId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }

  const selectedList = [...selected];
  /** 只能应用「选中且无冲突」的操作 —— 冲突必须先处理。 */
  const applicable = selectedList.filter((id) => !card.conflicted.includes(id));

  /*
   * 按钮可用性由**本地选中**决定，而不是直接用投影的 `card.canApply`。
   *
   * 这里踩过一个真实的坑：`canApply` 是基于**投影里已接受的操作**
   * （即持久化的决策状态）计算的，而用户此时是在本地勾选 ——
   * 两者是不同的东西。直接用它会导致「用户勾上了但按钮仍然禁用」，
   * 界面看起来坏掉了。
   *
   * 正确的判据是：提案不处于终态（终态不该再让人应用）+ 本地选中非空。
   * 注意这不涉及「是否已保存」的判断 —— 落盘只看提交回执。
   */
  const isTerminal = card.status === "committed" || card.status === "rejected";
  const canSubmit = !isTerminal && applicable.length > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate font-medium">{card.title}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            已选 {applicable.length}/{card.totalCount}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      {collapsed && hiddenByCollapse > 0 && (
        // 如实说明折叠隐藏了几组，而不是让用户以为没有别的内容。
        <p className="mt-1 text-xs text-muted-foreground">
          已收起 {hiddenByCollapse} 组修改
        </p>
      )}

      <ul className="mt-2 space-y-2">
        {groups.map((group) => (
          <GroupBlock
            key={group.id}
            group={group}
            card={card}
            selected={selected}
            onToggle={toggle}
            onLocate={onLocate}
          />
        ))}
      </ul>

      {card.conflicted.length > 0 && (
        <p className="mt-2 text-xs text-destructive">
          有 {card.conflicted.length} 处冲突未解决，处理后才可应用。
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {/*
         * 「应用」按钮的可用性由投影的 `canApply` 与本地选中共同决定。
         * 注意按钮文案是「应用」而不是「保存」—— 落盘由调用方负责，
         * 且只有拿到回执才谈得上「已保存」。
         */}
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          onClick={() => void onApply(applicable)}
        >
          应用
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={selectedList.length === 0}
          onClick={() => void onReject(selectedList)}
        >
          拒绝
        </Button>
      </div>
    </div>
  );
}
