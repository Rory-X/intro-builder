"use client";
import { Star, Loader2, Check, X } from "lucide-react";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";

export type TemplatePanelItem = {
  id: string;
  name: string;
  resolved: SerializableResolvedTemplate;
};

type Props = {
  /** 当前用户收藏的模板（在 all 之内，已去孤儿）。空数组则不渲染收藏分组。 */
  favorites: TemplatePanelItem[];
  /** 全部可选模板（builtin + uploaded，已去重）。 */
  all: TemplatePanelItem[];
  currentTemplateId: string;
  /** 正在套用中的 templateId（显示 loading，非 null 时禁用其它项防连点）。 */
  pendingTemplateId: string | null;
  /** 缩略图渲染用的内容快照 —— 用用户当前简历内容，预览即所得。 */
  previewContent: ResumeContent;
  onApply: (id: string) => void;
  onClose: () => void;
  className?: string;
};

/**
 * 编辑器内的模板切换侧面板（覆盖左侧表单列，右侧预览常驻可见）。形态对齐 Canva
 * 左侧 Templates 面板：「已收藏」置顶分组 + 「全部模板」，大缩略图、点击实时套用。
 * 不是 popover、不带数字徽章 —— popover 面积不足以做视觉对比。
 */
export function TemplateSwitchPanel({
  favorites,
  all,
  currentTemplateId,
  pendingTemplateId,
  previewContent,
  onApply,
  onClose,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-col bg-background", className)}>
      <div className="flex items-center border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">选择模板</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭模板面板"
          className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="thin-scrollbar flex-1 overflow-y-auto p-4">
        {favorites.length > 0 && (
          <section className="mb-6">
            <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
              已收藏
            </h4>
            <TemplateGrid
              items={favorites}
              currentTemplateId={currentTemplateId}
              pendingTemplateId={pendingTemplateId}
              previewContent={previewContent}
              onApply={onApply}
            />
          </section>
        )}
        <section>
          <h4 className="mb-3 text-xs font-semibold text-muted-foreground">全部模板</h4>
          <TemplateGrid
            items={all}
            currentTemplateId={currentTemplateId}
            pendingTemplateId={pendingTemplateId}
            previewContent={previewContent}
            onApply={onApply}
          />
        </section>
      </div>
    </div>
  );
}

function TemplateGrid({
  items,
  currentTemplateId,
  pendingTemplateId,
  previewContent,
  onApply,
}: {
  items: TemplatePanelItem[];
  currentTemplateId: string;
  pendingTemplateId: string | null;
  previewContent: ResumeContent;
  onApply: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const isCurrent = item.id === currentTemplateId;
        const isPending = pendingTemplateId === item.id;
        const disabled = pendingTemplateId !== null || isCurrent;
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onApply(item.id)}
            aria-label={isCurrent ? `${item.name}（使用中）` : `套用模板 ${item.name}`}
            className={cn(
              "group relative flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors",
              isCurrent
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-primary/40",
              pendingTemplateId !== null && !isPending && "opacity-50",
            )}
          >
            <div className="overflow-hidden rounded">
              <TemplateThumbnail forceMount>
                <ClientTemplateRenderFromSerializable
                  resolved={item.resolved}
                  content={previewContent}
                  sectionOrder={previewContent.sectionOrder}
                  styleSettings={previewContent.styleSettings}
                />
              </TemplateThumbnail>
            </div>
            <span className="flex items-center justify-between gap-1 px-0.5 pb-0.5">
              <span className="truncate text-xs font-medium">{item.name}</span>
              {isCurrent && (
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-primary">
                  <Check className="size-3" />使用中
                </span>
              )}
            </span>
            {isPending && (
              <span className="absolute inset-0 grid place-items-center rounded-lg bg-background/60">
                <Loader2 className="size-5 animate-spin text-primary" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
