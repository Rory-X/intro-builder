"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { A4_WIDTH_PX } from "@/lib/pagination";

/**
 * baseWidth 与页面渲染（live preview / pagination / PDF 路由）共享同一个
 * A4_WIDTH_PX (794px @ 96dpi)，保证缩略图、编辑器预览、PDF 三处的内容
 * 排版宽度完全一致 —— 同一份简历在三处看到的字号 / 行宽 / 换行点是相同的。
 * 之前 hard-code 595（A4@72dpi）会让缩略图按更窄的版面排版后再缩放，跟
 * 实际页面密度不一致。
 */
export const FIT_THUMBNAIL_DEFAULT_BASE_WIDTH = A4_WIDTH_PX;

type FitOpts = {
  containerRef: RefObject<HTMLElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  /** 内容尚未挂载时（懒加载阶段）置 false 跳过测量 */
  enabled: boolean;
  baseWidth?: number;
};

type Fit = { scale: number; offsetX: number };

/**
 * 把 595×N 的 stage 缩放进任意 aspect-ratio 的 thumb 容器，且**全文可见、
 * 顶部对齐**。和"固定 scale + 裁切"的天真做法相比，这里按 stage 真实
 * scrollHeight 算 height-scale，再和 width-scale 取 min —— 内容长（1500px+
 * 的简历）按高度收敛、内容短（800px）按宽度收敛、不会出现底部留白或裁切。
 *
 * 重测时机：ResizeObserver(container) + document.fonts.ready —— 字体未加载
 * 完成时 scrollHeight 偏小，加载完高度跳变（中文字体常见 100-200px 跳）。
 */
export function useFitThumbnail({
  containerRef,
  stageRef,
  enabled,
  baseWidth = FIT_THUMBNAIL_DEFAULT_BASE_WIDTH,
}: FitOpts): Fit {
  const [fit, setFit] = useState<Fit>({ scale: 0, offsetX: 0 });

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    const measure = () => {
      const thumbW = container.clientWidth;
      const thumbH = container.clientHeight;
      // scrollHeight 忽略 CSS transform，所以读到的是未缩放的内容真实高度
      const tplH = stage.scrollHeight;
      if (thumbW === 0 || thumbH === 0 || tplH === 0) return;
      const scale = Math.min(thumbW / baseWidth, thumbH / tplH);
      const offsetX = (thumbW - baseWidth * scale) / 2;
      setFit((prev) =>
        prev.scale === scale && prev.offsetX === offsetX
          ? prev
          : { scale, offsetX },
      );
    };

    measure();

    let cancelled = false;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!cancelled) measure();
          })
        : null;
    ro?.observe(container);

    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [enabled, baseWidth, containerRef, stageRef]);

  return fit;
}
