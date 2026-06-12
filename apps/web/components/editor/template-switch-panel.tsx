"use client";
import { useState } from "react";
import { Star, Loader2, Check, X, ChevronRight } from "lucide-react";
import Link from "next/link";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { cn } from "@/lib/utils";

export type TemplatePanelItem = {
  id: string;
  name: string;
  resolved: SerializableResolvedTemplate;
};

type Props = {
  favorites: TemplatePanelItem[];
  /** 最新上线的模板（最多 20 条），用于"模板库"tab。 */
  recent: TemplatePanelItem[];
  currentTemplateId: string;
  pendingTemplateId: string | null;
  previewContent: ResumeContent;
  onApply: (id: string) => void;
  onClose: () => void;
  className?: string;
};

export function TemplateSwitchPanel({
  favorites,
  recent,
  currentTemplateId,
  pendingTemplateId,
  previewContent,
  onApply,
  onClose,
  className,
}: Props) {
  const [tab, setTab] = useState<"favorites" | "browse">("favorites");

  return (
    <div className={cn("flex flex-col bg-background", className)}>
      {/* Header with tabs */}
      <div className="flex items-center border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("favorites")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === "favorites"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Star className={cn("size-3", tab === "favorites" && "fill-yellow-400 text-yellow-400")} />
            收藏
          </button>
          <button
            type="button"
            onClick={() => setTab("browse")}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === "browse"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            模板库
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭模板面板"
          className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="thin-scrollbar flex-1 overflow-y-auto p-3">
        {tab === "favorites" ? (
          <FavoritesTab
            favorites={favorites}
            currentTemplateId={currentTemplateId}
            pendingTemplateId={pendingTemplateId}
            previewContent={previewContent}
            onApply={onApply}
          />
        ) : (
          <BrowseTab
            recent={recent}
            currentTemplateId={currentTemplateId}
            pendingTemplateId={pendingTemplateId}
            previewContent={previewContent}
            onApply={onApply}
          />
        )}
      </div>
    </div>
  );
}

function FavoritesTab({
  favorites,
  currentTemplateId,
  pendingTemplateId,
  previewContent,
  onApply,
}: {
  favorites: TemplatePanelItem[];
  currentTemplateId: string;
  pendingTemplateId: string | null;
  previewContent: ResumeContent;
  onApply: (id: string) => void;
}) {
  if (favorites.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
        还没有收藏的模板。去{" "}
        <a href="/templates" className="font-medium text-primary hover:underline">
          模板库
        </a>{" "}
        点五角星收藏，这里就能一键换 ✨
      </div>
    );
  }
  return (
    <TemplateGrid
      items={favorites}
      currentTemplateId={currentTemplateId}
      pendingTemplateId={pendingTemplateId}
      previewContent={previewContent}
      onApply={onApply}
    />
  );
}

function BrowseTab({
  recent,
  currentTemplateId,
  pendingTemplateId,
  previewContent,
  onApply,
}: {
  recent: TemplatePanelItem[];
  currentTemplateId: string;
  pendingTemplateId: string | null;
  previewContent: ResumeContent;
  onApply: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <TemplateGrid
        items={recent}
        currentTemplateId={currentTemplateId}
        pendingTemplateId={pendingTemplateId}
        previewContent={previewContent}
        onApply={onApply}
      />
      <Link
        href="/templates"
        className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        查看全部模板
        <ChevronRight className="size-3" />
      </Link>
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
                  interactive={false}
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
