"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FIT_THUMBNAIL_DEFAULT_BASE_WIDTH,
  useFitThumbnail,
} from "./use-fit-thumbnail";

type Props = {
  /**
   * 真正的模板渲染。父级（Gallery）负责 dispatch（builtin Layout vs
   * UploadedLayout），thumbnail 只负责"装进 A4 框 + 自适应缩放 + 懒挂载"。
   * 解耦让 thumbnail 既能被 builtin 模板用、也能被 uploaded 模板用、还能被
   * 任何未来的渲染源用，无需改 thumbnail 本身。
   */
  children: React.ReactNode;
  /**
   * 懒挂载：默认 true。8 张缩略图同时挂载会卡（每张都是完整模板树 + tiptap
   * 内容渲染），用 IntersectionObserver 在卡进入视口前 200px 才挂载。
   */
  lazy?: boolean;
  className?: string;
  /** 模板渲染的天然宽度，默认 A4@72dpi 的 595px。 */
  baseWidth?: number;
  /** 测试 / 必须立刻渲染（如选中态预览）时跳过懒挂载。 */
  forceMount?: boolean;
};

export function TemplateThumbnail({
  children,
  lazy = true,
  className,
  baseWidth = FIT_THUMBNAIL_DEFAULT_BASE_WIDTH,
  forceMount = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // 决定初始 mounted 状态在 useState lazy initializer 里完成（forceMount /
  // lazy=false / SSR-test 环境没有 IntersectionObserver 都直接挂载）。
  // 放这里而非 effect 里调 setState，避免 React Compiler 抓的"effect 里
  // setState 触发级联 render"问题。
  const [mounted, setMounted] = useState<boolean>(() => {
    if (!lazy || forceMount) return true;
    if (typeof IntersectionObserver === "undefined") return true;
    return false;
  });

  useEffect(() => {
    if (mounted) return;
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
  }, [mounted]);

  const { scale, offsetX } = useFitThumbnail({
    containerRef,
    stageRef,
    enabled: mounted,
    baseWidth,
  });

  return (
    <div
      ref={containerRef}
      data-template-thumbnail=""
      className={cn(
        "relative aspect-[210/297] w-full overflow-hidden rounded-md bg-white",
        className,
      )}
    >
      {mounted ? (
        <div
          ref={stageRef}
          data-template-thumbnail-stage=""
          style={{
            position: "absolute",
            top: 0,
            left: `${offsetX}px`,
            width: `${baseWidth}px`,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
          }}
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
