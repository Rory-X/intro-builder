"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import {
  ClientTemplateRenderFromSerializable,
  type SerializableResolvedTemplate,
} from "@/lib/templates/render";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { cn } from "@/lib/utils";

/** 弹窗里一份可选简历的精简数据（content 用于缩略图渲染）。 */
export type PickerResume = {
  id: string;
  title: string;
  content: ResumeContent;
  /** 该简历当前所用模板 id，用来在 resumeTemplates 里查序列化模板。 */
  templateId: string;
  /** 服务端算好的相对修改时间，如「最近修改」「3 天前」。 */
  updatedLabel: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已按 updatedAt desc 排序的简历列表（最近修改在前）。 */
  resumes: PickerResume[];
  /** templateId → 序列化模板。缩略图按每份简历「当前模板」渲染（套用前的样子），
      帮用户认出是哪份。同模板多份共用一份，省 payload。 */
  resumeTemplates: Record<string, SerializableResolvedTemplate>;
  /** 正要套用的模板名（放标题里）。 */
  templateName: string;
  /** 默认选中（最近修改 / ?resumeId= 来源）。 */
  defaultSelectedId: string | null;
  /** 确认应用 → 把当前模板套到该简历。 */
  onConfirm: (resumeId: string) => void;
  /** ＋新建简历 → 新建一份空简历并套用当前模板。 */
  onCreateNew: () => void;
  isApplying?: boolean;
};

/**
 * 「应用到哪份简历」选择弹窗。
 *
 * 横向滚动列出全部简历，每张卡用该简历当前模板渲染缩略图（套用前样子，便于
 * 辨认）。缩略图懒渲染靠 `TemplateThumbnail` 内置的 IntersectionObserver +
 * 骨架屏 —— 打开弹窗只渲染可视区那几张，其余滚动时才挂载，不要传 forceMount。
 */
export function ResumePickerDialog({
  open,
  onOpenChange,
  resumes,
  resumeTemplates,
  templateName,
  defaultSelectedId,
  onConfirm,
  onCreateNew,
  isApplying = false,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(defaultSelectedId);

  // 每次打开都回到默认选中（最近修改那份），避免上次的选择残留。
  useEffect(() => {
    if (open) {
      // 仅在打开瞬间同步一次，不会 ping-pong（gated on open）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(defaultSelectedId);
    }
  }, [open, defaultSelectedId]);

  const selected = resumes.find((r) => r.id === selectedId) ?? null;

  const handleConfirm = () => {
    if (!selectedId) return;
    onConfirm(selectedId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]"
        data-testid="resume-picker"
      >
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle className="text-[17px]">应用到哪份简历？</DialogTitle>
          <DialogDescription className="text-[13px]">
            把
            <span className="font-semibold text-primary"> {templateName} </span>
            套到选中的简历上 · 按最近修改排序
          </DialogDescription>
        </DialogHeader>

        {/* 横向滚动轨道 —— 初始可视约 3 张，第 4 张露边提示可滑 */}
        <div className="relative min-h-0">
          <div
            className="flex gap-3.5 overflow-x-auto overflow-y-hidden px-6 py-5 [scroll-padding-left:1.5rem]"
            style={{ scrollSnapType: "x proximity" }}
          >
            {/* ＋新建简历：横滚最前，用此模板新建一份（0 份简历的入口也在这） */}
            <button
              type="button"
              data-testid="resume-picker-new"
              disabled={isApplying}
              onClick={onCreateNew}
              className="group flex w-[232px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-border bg-muted/30 text-center text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.04] hover:text-primary disabled:pointer-events-none disabled:opacity-60"
              style={{ scrollSnapAlign: "start" }}
            >
              <span className="grid size-12 place-items-center rounded-full bg-muted text-2xl font-light transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                ＋
              </span>
              <span className="text-sm font-semibold">新建简历</span>
              <span className="text-[11px] text-muted-foreground/80">
                用此模板新建一份
              </span>
            </button>

            {resumes.map((r) => {
              const tpl = resumeTemplates[r.templateId];
              const isSel = r.id === selectedId;
              return (
                <button
                  type="button"
                  key={r.id}
                  data-testid="resume-picker-card"
                  data-resume-id={r.id}
                  aria-pressed={isSel}
                  onClick={() => setSelectedId(r.id)}
                  onDoubleClick={() => onConfirm(r.id)}
                  className={cn(
                    "group relative flex w-[232px] shrink-0 flex-col overflow-hidden rounded-xl border-2 bg-card text-left transition-all",
                    isSel
                      ? "border-primary ring-2 ring-primary/15"
                      : "border-border/70 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
                  )}
                  style={{ scrollSnapAlign: "start" }}
                >
                  {isSel && (
                    <span className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-primary text-[13px] text-primary-foreground">
                      ✓
                    </span>
                  )}
                  <div className="border-b border-border/60">
                    {tpl ? (
                      <TemplateThumbnail>
                        <ClientTemplateRenderFromSerializable
                          resolved={tpl}
                          content={r.content}
                          sectionOrder={r.content.sectionOrder}
                          styleSettings={r.content.styleSettings}
                          interactive={false}
                        />
                      </TemplateThumbnail>
                    ) : (
                      <div className="aspect-[210/297] w-full bg-muted" />
                    )}
                  </div>
                  <div className="p-2.5">
                    <div className="truncate text-[13px] font-semibold">
                      {r.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.updatedLabel}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {/* 右缘渐隐，暗示还有更多可滑 */}
          <div className="pointer-events-none absolute inset-y-5 right-0 w-10 bg-gradient-to-l from-popover to-transparent" />
        </div>

        <div className="flex items-center gap-2.5 border-t border-border/60 px-6 py-4">
          <span className="mr-auto truncate text-xs text-muted-foreground">
            {selected ? `已选：${selected.title}` : "请选择一份简历"}
          </span>
          <Button
            variant="outline"
            disabled={isApplying}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            data-testid="resume-picker-apply"
            disabled={!selectedId || isApplying}
            onClick={handleConfirm}
          >
            {isApplying ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                正在应用…
              </>
            ) : (
              "应用模板"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
