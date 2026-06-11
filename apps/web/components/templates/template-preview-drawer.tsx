"use client";

import { useState } from "react";
import { Loader2, Check, Star } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = drawer 还没选定（首次打开会立刻选；切模板时会更新） */
  resolved: SerializableResolvedTemplate | null;
  /** 默认占位内容；toggle OFF 时左侧预览渲染这份。 */
  demoContent: ResumeContent;
  /** 用户最近一份简历的 content；null 表示还没建简历，toggle 会被禁用。 */
  userContent: ResumeContent | null;
  /** @deprecated 已不参与 apply 禁用逻辑（apply 始终可点：0 份走新建，≥1 份开弹窗）。
      保留仅为向后兼容现有调用方，可在后续清理中移除。 */
  resumeId?: string | null;
  /** apply 是否进行中（父组件控制 setTemplate 的 pending 态） */
  isApplying?: boolean;
  /** apply 回调 —— 父组件接管：0 份直接新建套用，≥1 份打开选择弹窗 */
  onApply: () => void | Promise<void>;
  /** 用户简历数量，决定 apply 按钮文案（0 份「用此模板新建简历」，否则「应用到简历…」）。 */
  resumeCount?: number;
  /** 当前模板是否已被收藏（父组件的 favorites Set 派生）。 */
  isFavorited?: boolean;
  /** 收藏切换回调 —— 父组件接管乐观更新 + action。缺省时不渲染收藏控件。 */
  onToggleFavorite?: () => void;
};

function getDisplayMeta(resolved: SerializableResolvedTemplate) {
  return {
    name: resolved.name ?? resolved.id,
    description: resolved.description ?? "",
    isRecommended: false as const,
    features: resolved.features as readonly string[] | undefined,
  };
}

export function TemplatePreviewDrawer({
  open,
  onOpenChange,
  resolved,
  demoContent,
  userContent,
  isApplying = false,
  onApply,
  resumeCount = 1,
  isFavorited = false,
  onToggleFavorite,
}: Props) {
  // toggle 控件 state（默认 OFF —— demo 内容预览）。
  // 限制：userContent === null 时强制 OFF（没简历可用），UI 上 disabled 提示。
  const [useMyContent, setUseMyContent] = useState(false);
  const canUseMyContent = userContent !== null;
  const previewContent =
    useMyContent && userContent ? userContent : demoContent;

  // resolved=null 时不渲染内部预览（防 ClientTemplateRenderFromSerializable 拿到 null 报错）
  // Sheet 仍然打开，但内部留空白 —— 实际应用 onOpenChange 会同步关闭。
  const meta = resolved ? getDisplayMeta(resolved) : null;
  // 渲染右侧 aside 的小 tag —— 优先用模板自己的 category（学术 / 互联网 / 商务 等），
  // 没填时降级显示空白（不要回退到"内置/上传"——那是开发者维度，不是用户维度）。
  const CATEGORY_LABELS_DRAWER: Record<string, string> = {
    academic: "学术",
    tech: "互联网",
    business: "商务",
    creative: "创意",
    general: "通用",
  };
  const categoryRaw = resolved
    ? resolved.category
    : undefined;
  const sourceLabel = categoryRaw ? CATEGORY_LABELS_DRAWER[categoryRaw] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Sheet 默认 `data-[side=right]:sm:max-w-sm`（384px），用相同
        // 选择器才能让 tailwind-merge 识别为同组覆盖。否则我们这条
        // `sm:max-w-[960px]` 被默认值赢掉（特异性更高），整个抽屉被卡
        // 在 384px，左侧 1fr 预览栏被右边 320px 挤成 ~60px，缩略图缩到
        // 芝麻大。`w-full` 已经把宽度兜在 viewport 内，所以只需 max-w
        // 单边约束。
        className="flex h-full w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[960px]"
      >
        <SheetHeader className="border-b border-border/60 px-6 py-5">
          <SheetTitle className="text-lg font-semibold tracking-tight">
            {meta ? meta.name : "模板预览"}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground/80">
            {meta?.description ?? "选一个模板看看效果，确认后再应用到简历"}
          </SheetDescription>
        </SheetHeader>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_320px]">
          {/* Left: A4 preview area —— scrollable + 自适应缩放 */}
          <div className="overflow-auto bg-muted/40 p-6">
            <div className="mx-auto max-w-[600px]">
              {resolved ? (
                <div className="overflow-hidden rounded-md bg-white shadow-md ring-1 ring-border">
                  <TemplateThumbnail forceMount fit="contain">
                    <ClientTemplateRenderFromSerializable
                      resolved={resolved}
                      content={previewContent}
                      sectionOrder={previewContent.sectionOrder}
                      styleSettings={previewContent.styleSettings}
                    />
                  </TemplateThumbnail>
                </div>
              ) : (
                <div className="aspect-[210/297] rounded-md bg-card" />
              )}
            </div>
          </div>

          {/* Right: meta + features + CTA */}
          <aside className="flex flex-col gap-5 overflow-y-auto border-t border-border/60 p-6 md:border-t-0 md:border-l md:border-border/60">
            {meta && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  {sourceLabel && (
                    <span className="rounded-full bg-muted/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground/90">
                      {sourceLabel}
                    </span>
                  )}
                  {meta.isRecommended && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      推荐
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-[13px] font-semibold tracking-tight text-foreground/90">这个模板的特点</h3>
              <ul className="space-y-2.5 text-sm">
                {(meta?.features && meta.features.length > 0
                  ? meta.features
                  : [
                      "预览即所见 —— 应用后样式跟这里 100% 一致",
                      "不动你的简历内容，只换排版",
                      "切换后随时再换，可逆",
                    ]
                ).map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary/80" />
                    <span className="leading-relaxed text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* "用我的内容预览" toggle —— 从 /templates 顶部迁过来。
                这里语境更对：用户已经选定具体一个模板要看效果，再决定用 demo
                还是真实内容。userContent === null（没建简历）时禁用。 */}
            <label
              htmlFor="drawer-use-my-content"
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
                !canUseMyContent && "opacity-60",
              )}
            >
              <span className="relative inline-flex h-5 w-9 shrink-0">
                <input
                  id="drawer-use-my-content"
                  type="checkbox"
                  className="peer sr-only"
                  checked={useMyContent}
                  disabled={!canUseMyContent}
                  onChange={(e) => setUseMyContent(e.target.checked)}
                  data-testid="drawer-use-my-content-toggle"
                />
                <span className="pointer-events-none absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-primary peer-disabled:cursor-not-allowed" />
                <span className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">用我的内容预览</span>
                <span className="text-xs text-muted-foreground">
                  {canUseMyContent
                    ? "把你最近一份简历套到这个模板上看效果"
                    : "需要先创建一份简历才能开启"}
                </span>
              </span>
            </label>

            {/* 收藏控件：放「用我的内容预览」下方 —— 顶部和底部都不好找，这里在
                信息流中间、apply CTA 上方，最易发现。收藏后五角星填充黄色。
                缺省不渲染（向后兼容）。 */}
            {onToggleFavorite && (
              <Button
                type="button"
                variant="outline"
                onClick={onToggleFavorite}
                aria-pressed={isFavorited}
                aria-label={
                  isFavorited ? `取消收藏 ${meta?.name ?? ""}` : `收藏 ${meta?.name ?? ""}`
                }
                className="justify-center gap-2 border-border/60 text-muted-foreground/80 transition-colors duration-200 hover:text-foreground"
                data-testid="drawer-favorite"
              >
                <Star
                  className={cn(
                    "size-4",
                    isFavorited && "fill-yellow-400 text-yellow-400",
                  )}
                />
                {isFavorited ? "已收藏" : "收藏此模板"}
              </Button>
            )}

            <div className="mt-auto flex flex-col gap-2 pt-4">
              <Button
                type="button"
                size="lg"
                disabled={isApplying}
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
                ) : resumeCount === 0 ? (
                  "用此模板新建简历"
                ) : (
                  "应用到简历…"
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
