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
  // **始终从 false 开始** —— SSR 与 client 首次 render 都输出 skeleton。
  // 不能依赖 `typeof IntersectionObserver === "undefined"` 在 useState
  // initializer 里"提前判断 SSR"：那样 server (无 IO → true) 与 client
  // (有 IO → false) 首次 render 不一致 → React 报 hydration mismatch
  // (server rendered HTML didn't match client)。canonical 修法就是把
  // "决定何时翻牌"挪到 useEffect，因为 useEffect 只在 client 跑、必然在
  // hydration 之后，怎么 setState 都不会触发 mismatch。
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    if (mounted) return;
    // forceMount / lazy=false / 测试或老浏览器无 IO → hydration 后立即翻
    if (forceMount || !lazy || typeof IntersectionObserver === "undefined") {
      // 这里的 setState-in-effect 是 SSR-safe hydration 的 canonical pattern：
      // useState 必须从 false 开始（保证 server / client 首次 render 一致），
      // 翻牌只能在 effect 里。React Compiler 默认抓"级联 render"是为了防 ping-
      // pong loop，但本路径只翻一次（mounted 后 effect 立即 return），不会循环。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // IO 回调里 setState 不是"effect body 里 setState"，是外部事件回调，
          // 自然不触发 set-state-in-effect 规则。
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
