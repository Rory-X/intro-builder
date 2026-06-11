"use client";

import { useCallback, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import type { ResumeContent, StyleSettings } from "@intro-builder/shared/schemas";
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
   * profileFontSize is locked to the user's original value so header stays fixed.
   */
  const makeMeasure = useCallback(
    (currentProfileFontSize: number) => (settings: StyleSettings): Promise<number> => {
      return new Promise((resolve) => {
        const root = measureRef.current;
        if (!root) {
          resolve(Infinity);
          return;
        }

        const container = findSmartLayoutMeasurementContainer(root);
        if (!container) {
          resolve(Infinity);
          return;
        }

        // Find the resume root inside the container. v2 模板渲染出的根节点是
        // <div data-resume-page>（见 html-slot-renderer），不再是旧的 <article>。
        // 找错节点会走进下面的 fallback、不套用测试设置 → measure() 对任何
        // settings 都返回同一个高度 → 二分搜索空转、算法退化成"不压或压到底"
        // （zoo 反馈的"重度压缩 + 下方大片留白"根因）。article 作为旧模板兜底。
        const measureEl =
          (container.querySelector("[data-resume-page]") as HTMLElement | null) ??
          (container.querySelector("article") as HTMLElement | null);
        if (!measureEl) {
          resolve(container.scrollHeight);
          return;
        }

        // Apply settings temporarily. v2 模板所有排版参数都走 CSS 变量管道
        // （--font-size / --body-line-height / --heading-gap / ...，见
        // html-slot-renderer 的 cssVars），所以这里覆盖 CSS 变量即可让模板 CSS
        // 通过 var() 读到测试值，不必直接写 fontSize/padding。CSS 自定义属性会
        // 向下继承到 .xxx-template，字号/行距/间距随之变化。
        const ss = mergeStyleSettings(settings);
        const originalStyle = measureEl.getAttribute("style") ?? "";
        measureEl.style.setProperty("--font-family", FONT_MAP[ss.fontFamily].css);
        measureEl.style.setProperty("--font-size", `${ss.fontSize}px`);
        measureEl.style.setProperty("--profile-font-size", `${currentProfileFontSize}px`);
        measureEl.style.setProperty("--line-height", `${ss.bodyLineHeight}`);
        measureEl.style.setProperty("--body-line-height", `${ss.bodyLineHeight}`);
        measureEl.style.setProperty("--heading-gap", `${ss.headingGap}px`);
        measureEl.style.setProperty("--page-padding", `${ss.pagePadding}px`);
        measureEl.style.setProperty("--section-gap", `${ss.sectionGap}px`);
        measureEl.style.setProperty("--item-gap", `${ss.itemGap}px`);

        // Wait for layout to settle, then measure
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const totalHeight = container.scrollHeight;
          // Restore original style
          measureEl.setAttribute("style", originalStyle);
          resolve(totalHeight);
        });
      });
    },
    [measureRef],
  );

  const calculate = useCallback(async (): Promise<SmartLayoutResult> => {
    const currentSettings = mergeStyleSettings(form.getValues("styleSettings"));
    const measure = makeMeasure(currentSettings.fontSize);
    setIsCalculating(true);
    try {
      const result = await findOptimalSettings(currentSettings, measure);
      return result;
    } finally {
      setIsCalculating(false);
    }
  }, [form, makeMeasure]);

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

export function findSmartLayoutMeasurementContainer(root: HTMLElement | null): HTMLElement | null {
  const previewRoot = root?.closest("[data-paginated-preview-root]");
  if (!previewRoot) return null;
  return previewRoot.querySelector("[aria-hidden='true']") as HTMLElement | null;
}
