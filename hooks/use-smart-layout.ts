"use client";

import { useCallback, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { findOptimalSettings, type SmartLayoutResult } from "@/lib/smart-layout";
import { mergeStyleSettings } from "@/lib/templates/shared/merge-style-settings";
import { FONT_MAP } from "@/lib/font-map";

type UseSmartLayoutOptions = {
  templateId: TemplateId;
  measureRef: React.RefObject<HTMLDivElement | null>;
};

export function useSmartLayout({ measureRef }: UseSmartLayoutOptions) {
  const form = useFormContext<ResumeContent>();
  const [isCalculating, setIsCalculating] = useState(false);
  const rafRef = useRef<number | null>(null);

  const smartLayout = form.watch("smartLayout");
  const isActive = smartLayout?.enabled ?? false;

  /**
   * Measure content height by temporarily applying style settings
   * to the measurement container and reading its scrollHeight.
   */
  const measure = useCallback(
    (settings: StyleSettings): Promise<number> => {
      return new Promise((resolve) => {
        const root = measureRef.current;
        if (!root) {
          resolve(Infinity);
          return;
        }

        // The measurement container is a sibling of the ref div (both inside containerRef).
        // Navigate to parent to find it.
        const parent = root.parentElement;
        const container = parent?.querySelector("[aria-hidden='true']") as HTMLElement | null;
        if (!container) {
          resolve(Infinity);
          return;
        }

        // Find the article element inside the container
        const article = container.querySelector("article") as HTMLElement | null;
        if (!article) {
          resolve(container.scrollHeight);
          return;
        }

        // Apply settings temporarily
        const ss = mergeStyleSettings(settings);
        const originalStyle = article.getAttribute("style") ?? "";
        article.style.fontSize = `${ss.fontSize}px`;
        article.style.lineHeight = `${ss.bodyLineHeight}`;
        article.style.paddingTop = "40px";
        article.style.paddingBottom = "40px";
        article.style.paddingLeft = `${ss.pagePadding}px`;
        article.style.paddingRight = `${ss.pagePadding}px`;
        article.style.fontFamily = FONT_MAP[ss.fontFamily].css;
        // sectionGap/itemGap/headingGap 走 CSS 变量管道——内置模板的
        // ResumeSection 和 v2 模板的用户 customCss 都通过
        // var(--section-gap)/var(--item-gap)/var(--heading-gap) 消费。
        // setProperty/setAttribute("style", original) 恢复机制天然覆盖
        // CSS 自定义属性，不需要单独清理。
        article.style.setProperty("--section-gap", `${ss.sectionGap}px`);
        article.style.setProperty("--item-gap", `${ss.itemGap}px`);
        article.style.setProperty("--heading-gap", `${ss.headingGap}px`);

        // Wait for layout to settle, then measure
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const totalHeight = container.scrollHeight;
          // Restore original style
          article.setAttribute("style", originalStyle);
          resolve(totalHeight);
        });
      });
    },
    [measureRef],
  );

  const calculate = useCallback(async (): Promise<SmartLayoutResult> => {
    const currentSettings = mergeStyleSettings(form.getValues("styleSettings"));
    setIsCalculating(true);
    try {
      const result = await findOptimalSettings(currentSettings, measure);
      return result;
    } finally {
      setIsCalculating(false);
    }
  }, [form, measure]);

  const apply = useCallback(
    (settings: StyleSettings) => {
      const currentSettings = mergeStyleSettings(form.getValues("styleSettings"));
      // Save original settings for revert
      form.setValue("smartLayout", {
        enabled: true,
        originalSettings: currentSettings,
      }, { shouldDirty: true });
      // Apply optimized settings
      form.setValue("styleSettings", settings, { shouldDirty: true });
    },
    [form],
  );

  const revert = useCallback(() => {
    const sl = form.getValues("smartLayout");
    if (sl?.originalSettings) {
      form.setValue("styleSettings", sl.originalSettings, { shouldDirty: true });
    }
    form.setValue("smartLayout", undefined, { shouldDirty: true });
  }, [form]);

  return { calculate, apply, revert, isCalculating, isActive };
}
