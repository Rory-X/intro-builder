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

        // v2 SlotRenderer renders <div data-resume-page>; built-in templates
        // render <article data-resume-page>. Keep article as a legacy fallback.
        const measureEl =
          (container.querySelector("[data-resume-page]") as HTMLElement | null) ??
          (container.querySelector("article") as HTMLElement | null);
        if (!measureEl) {
          resolve(container.scrollHeight);
          return;
        }

        // Built-ins consume inline font/padding styles; v2 templates consume
        // the CSS variables. Override both paths so measurement matches render.
        const ss = mergeStyleSettings(settings);
        const originalStyle = measureEl.getAttribute("style") ?? "";
        const fontFamily = FONT_MAP[ss.fontFamily].css;

        measureEl.style.fontSize = `${ss.fontSize}px`;
        measureEl.style.lineHeight = `${ss.bodyLineHeight}`;
        measureEl.style.paddingTop = "40px";
        measureEl.style.paddingBottom = "40px";
        measureEl.style.paddingLeft = `${ss.pagePadding}px`;
        measureEl.style.paddingRight = `${ss.pagePadding}px`;
        measureEl.style.fontFamily = fontFamily;
        measureEl.style.setProperty("--font-family", fontFamily);
        measureEl.style.setProperty("--font-size", `${ss.fontSize}px`);
        measureEl.style.setProperty("--line-height", `${ss.bodyLineHeight}`);
        measureEl.style.setProperty("--body-line-height", `${ss.bodyLineHeight}`);
        measureEl.style.setProperty("--heading-gap", `${ss.headingGap}px`);
        measureEl.style.setProperty("--page-padding", `${ss.pagePadding}px`);
        measureEl.style.setProperty("--section-gap", `${ss.sectionGap}px`);
        measureEl.style.setProperty("--item-gap", `${ss.itemGap}px`);
        measureEl.style.setProperty("--photo-scale", `${ss.photoScale ?? 1}`);

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
