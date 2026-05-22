"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * A thin top progress bar that shows during page navigation.
 * Similar to NProgress but implemented with pure CSS transitions.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // When pathname changes, the navigation completed
    setLoading(false);
    setProgress(100);
    const timer = setTimeout(() => setProgress(0), 200);
    return () => clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    // Intercept link clicks to detect navigation start
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:")) return;
      if (target.getAttribute("target") === "_blank") return;
      // Same page — no loading
      if (href === pathname) return;

      setLoading(true);
      setProgress(20);
      // Simulate progress
      const t1 = setTimeout(() => setProgress(50), 100);
      const t2 = setTimeout(() => setProgress(70), 300);
      const t3 = setTimeout(() => setProgress(85), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  if (!loading && progress === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5">
      <div
        className="h-full bg-primary shadow-[0_0_8px] shadow-primary/50 transition-all duration-300 ease-out"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
          transition: progress === 0 ? "none" : "width 300ms ease-out, opacity 200ms ease-in 100ms",
        }}
      />
    </div>
  );
}
