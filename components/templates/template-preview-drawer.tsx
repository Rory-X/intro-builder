"use client";

import { Loader2, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TEMPLATES } from "@/lib/templates/registry";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeContent } from "@/lib/resume-schema";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = drawer 还没选定（首次打开会立刻选；切模板时会更新） */
  resolved: SerializableResolvedTemplate | null;
  /** 当前用于预览的简历内容（gallery 的 toggle 决定是 demo 还是用户内容） */
  content: ResumeContent;
  /** 用户最近一份简历 id；null 时禁用 apply CTA + 提示先建简历 */
  resumeId: string | null;
  /** apply 是否进行中（父组件控制 setTemplate 的 pending 态） */
  isApplying?: boolean;
  /** apply 回调 —— 父组件接管 setTemplate / toast / redirect 链路 */
  onApply: () => void | Promise<void>;
};

function getDisplayMeta(resolved: SerializableResolvedTemplate) {
  if (resolved.source === "builtin") {
    const meta = TEMPLATES.find((t) => t.id === resolved.id);
    return {
      name: meta?.name ?? resolved.id,
      description: meta?.description ?? "",
      isRecommended: meta?.isRecommended,
    };
  }
  return {
    name: resolved.template.name,
    description: resolved.template.description ?? "",
    isRecommended: false as const,
  };
}

export function TemplatePreviewDrawer({
  open,
  onOpenChange,
  resolved,
  content,
  resumeId,
  isApplying = false,
  onApply,
}: Props) {
  // resolved=null 时不渲染内部预览（防 ClientTemplateRenderFromSerializable 拿到 null 报错）
  // Sheet 仍然打开，但内部留空白 —— 实际应用 onOpenChange 会同步关闭。
  const meta = resolved ? getDisplayMeta(resolved) : null;
  const sourceLabel =
    resolved?.source === "builtin"
      ? "内置"
      : resolved?.source === "uploaded"
        ? "上传"
        : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-[960px]"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-lg">
            {meta ? meta.name : "模板预览"}
          </SheetTitle>
          <SheetDescription>
            {meta?.description ?? "选一个模板看看效果，确认后再应用到简历"}
          </SheetDescription>
        </SheetHeader>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_320px]">
          {/* Left: A4 preview area —— scrollable + 自适应缩放 */}
          <div className="overflow-auto bg-muted/40 p-6">
            <div className="mx-auto max-w-[600px]">
              {resolved ? (
                <div className="overflow-hidden rounded-md bg-white shadow-md ring-1 ring-border">
                  <TemplateThumbnail forceMount>
                    <ClientTemplateRenderFromSerializable
                      resolved={resolved}
                      content={content}
                      sectionOrder={content.sectionOrder}
                      styleSettings={content.styleSettings}
                    />
                  </TemplateThumbnail>
                </div>
              ) : (
                <div className="aspect-[210/297] rounded-md bg-card" />
              )}
            </div>
          </div>

          {/* Right: meta + features + CTA */}
          <aside className="flex flex-col gap-5 overflow-y-auto border-t border-border p-6 md:border-t-0 md:border-l">
            {meta && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {sourceLabel && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {sourceLabel}
                    </span>
                  )}
                  {meta.isRecommended && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      推荐
                    </span>
                  )}
                </div>
                {meta.description && (
                  <p className="text-sm text-muted-foreground">
                    {meta.description}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">这个模板的特点</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>预览即所见 —— 应用后样式跟这里 100% 一致</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>不动你的简历内容，只换排版</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>切换后随时再换，可逆</span>
                </li>
              </ul>
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-4">
              {resumeId === null ? (
                <p className="rounded-md border border-dashed border-border/80 bg-muted/40 p-3 text-xs text-muted-foreground">
                  你还没创建简历。先到{" "}
                  <a
                    href="/dashboard"
                    className="font-medium text-primary hover:underline"
                  >
                    我的简历
                  </a>{" "}
                  建一份再来选模板 ✨
                </p>
              ) : null}
              <Button
                type="button"
                size="lg"
                disabled={!resumeId || isApplying}
                onClick={() => {
                  void onApply();
                }}
                data-testid="drawer-apply"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    正在应用…
                  </>
                ) : (
                  "应用到当前简历"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={isApplying}
                onClick={() => onOpenChange(false)}
                data-testid="drawer-cancel"
              >
                取消
              </Button>
            </div>
          </aside>
        </div>
      </SheetContent>
    </Sheet>
  );
}
