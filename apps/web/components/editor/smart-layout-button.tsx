"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { useSmartLayout } from "@/hooks/use-smart-layout";
import type { TemplateId } from "@/lib/templates/registry";
import { cn } from "@/lib/utils";

type Props = {
  templateId: TemplateId;
  measureRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Smart Layout toolbar button.
 * Click to auto-optimize typography settings for best single-page fit.
 * Click again to revert to original settings.
 */
export function SmartLayoutButton({ templateId, measureRef }: Props) {
  const { calculate, apply, revert, isCalculating, isActive } = useSmartLayout({
    templateId,
    measureRef,
  });

  async function handleClick() {
    if (isActive) {
      revert();
      toast.success("已还原排版设置");
      return;
    }

    const result = await calculate();

    switch (result.status) {
      case "already-fits":
        toast.info("简历已在一页内，无需优化");
        break;
      case "optimized":
        apply(result.settings);
        toast.success("已优化排版");
        break;
      case "cannot-fit":
        // Still apply the most compact settings possible
        apply(result.settings);
        toast.success("已应用最紧凑排版");
        break;
    }
  }

  return (
    <Button
      size="sm"
      variant={isActive ? "default" : "ghost"}
      onClick={handleClick}
      disabled={isCalculating}
      className={cn("gap-1.5", isActive && "bg-primary text-primary-foreground")}
    >
      {isCalculating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {isCalculating ? "计算中" : isActive ? "已优化" : "智能排版"}
    </Button>
  );
}
