"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FIT_THUMBNAIL_DEFAULT_BASE_WIDTH,
  useFitThumbnail,
} from "./use-fit-thumbnail";

type Props = {
  /**
   * 真正的模板渲染。父级（Gallery）负责 dispatch，thumbnail 只负责"装进
   * A4 框 + 缩放 + 懒挂载"。解耦让它能承载任何未来的渲染源。
   */
  children: React.ReactNode;
  /**
   * 懒挂载：默认 true。多张缩略图同时挂载会卡（每张都是完整模板树 + tiptap
   * 内容渲染），用 IntersectionObserver 在卡进入视口前 200px 才挂载。
   */
  lazy?: boolean;
  className?: string;
  /** 模板渲染的天然宽度，默认 A4@96dpi 的 794px（与实时预览 / PDF 一致）。 */
  baseWidth?: number;
  /** 测试 / 必须立刻渲染（如选中态预览）时跳过懒挂载。 */
  forceMount?: boolean;
  /**
   * 缩放模式：
   * - "page"（默认）：按**宽度**缩放（CSS container query），只露**首页**、超出裁切，
   *   放大率恒定 —— 无论简历多长，缩略图大小一致（dashboard 简历卡同款）。
   * - "contain"：按内容总高度自适应（min(宽,高)），**整份内容全可见**、顶部对齐。
   *   只给"看模板效果"的大预览（抽屉左侧）用。
   */
  fit?: "page" | "contain";
};

export function TemplateThumbnail({
  children,
  lazy = true,
  className,
  baseWidth = FIT_THUMBNAIL_DEFAULT_BASE_WIDTH,
  forceMount = false,
  fit = "page",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // **始终从 false 开始** —— SSR 与 client 首次 render 都输出 skeleton
  // （除非 forceMount 显式跳过）。翻牌挪到 useEffect（client-only）避免
  // hydration mismatch（详见下方 effect 注释）。
  const [mounted, setMounted] = useState<boolean>(false);

  const showStage = forceMount || mounted;

  useEffect(() => {
    if (mounted) return;
    // forceMount / lazy=false / 测试或老浏览器无 IO → hydration 后立即翻
    if (forceMount || !lazy || typeof IntersectionObserver === "undefined") {
      // SSR-safe hydration 的 canonical pattern：useState 从 false 起（保证
      // server / client 首次 render 一致），翻牌只在 effect 里且只翻一次。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          io.disconnect();
        }
      },
      // rootMargin 200px：滚动过来之前就挂载，让用户滚到时已经渲染好
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, forceMount, lazy]);

  // contain 模式才需要 JS 测量缩放；page 模式纯 CSS（cqw），忽略其结果。
  // Hook 不可条件调用 —— 始终调用，用 enabled 控制是否真测量。
  const { scale, offsetX } = useFitThumbnail({
    containerRef,
    stageRef,
    enabled: showStage && fit === "contain",
    baseWidth,
  });

  // page 模式：按宽度缩放（container query），stage 撑满容器宽、超出由容器
  // overflow-hidden 裁掉 → 只露首页、放大率恒定。
  // contain 模式：min(宽,高) 自适应 + 居中 → 整份可见。
  const stageStyle: React.CSSProperties =
    fit === "page"
      ? {
          width: `${baseWidth}px`,
          transformOrigin: "top left",
          transform: `scale(calc(100cqw / ${baseWidth}px))`,
        }
      : {
          position: "absolute",
          top: 0,
          left: `${offsetX}px`,
          width: `${baseWidth}px`,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
        };

  return (
    <div
      ref={containerRef}
      data-template-thumbnail=""
      className={cn(
        // [container-type:inline-size] 让 page 模式的 100cqw 解析为本容器宽度
        "relative aspect-[210/297] w-full overflow-hidden rounded-md bg-white [container-type:inline-size]",
        className,
      )}
    >
      {showStage ? (
        <div
          ref={stageRef}
          data-template-thumbnail-stage=""
          className="pointer-events-none"
          style={stageStyle}
        >
          {children}
        </div>
      ) : (
        <div
          data-template-thumbnail-skeleton=""
          aria-hidden
          className="absolute inset-0 animate-pulse bg-neutral-100 dark:bg-neutral-800"
        />
      )}
    </div>
  );
}
