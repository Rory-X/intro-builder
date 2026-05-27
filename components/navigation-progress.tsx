"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";

/**
 * Top progress bar + spinner using NProgress.
 *
 * Detection strategy:
 * - START: intercept clicks on <a> elements targeting internal routes
 * - COMPLETE: when usePathname()/useSearchParams() changes (page rendered)
 * - Also exports startProgress/doneProgress for programmatic navigation
 */

NProgress.configure({
  showSpinner: true,
  minimum: 0.08,
  trickleSpeed: 200,
  speed: 200,
});

// Export for programmatic use (e.g., router.push in event handlers)
export function startProgress() {
  NProgress.start();
}
export function doneProgress() {
  NProgress.done();
}

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prevUrl = useRef("");
  const listening = useRef(false);

  // COMPLETE: when route changes, finish the progress bar
  useEffect(() => {
    const url = `${pathname}?${searchParams?.toString() ?? ""}`;
    if (prevUrl.current && prevUrl.current !== url) {
      NProgress.done();
    }
    prevUrl.current = url;
  }, [pathname, searchParams]);

  // START: listen for link clicks on internal routes
  useEffect(() => {
    if (listening.current) return;
    listening.current = true;

    function handleClick(e: MouseEvent) {
      // Find the closest <a> element from the click target
      const anchor = (e.target as HTMLElement)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Skip external links, hash links, download links, new tab links
      if (
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        e.ctrlKey || e.metaKey || e.shiftKey || e.altKey
      ) {
        return;
      }

      // Check if it's an internal link
      try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin) return;
        // Skip if same page (same path + search, regardless of hash)
        if (url.pathname === location.pathname && url.search === location.search) return;
        // Skip if only the hash is different (anchor navigation)
        if (url.pathname === location.pathname && url.hash) return;
      } catch {
        return;
      }

      NProgress.start();
    }

    // Also patch pushState/replaceState for programmatic navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    function shouldStartForHistoryChange(newUrlArg: unknown) {
      if (!newUrlArg) return false;
      try {
        const newUrl = new URL(newUrlArg.toString(), location.origin);
        // Skip hash-only changes (same path + search)
        if (newUrl.pathname === location.pathname && newUrl.search === location.search) return false;
        return true;
      } catch {
        return false;
      }
    }

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      const result = originalPushState(...args);
      if (shouldStartForHistoryChange(args[2])) {
        NProgress.start();
      }
      return result;
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      const result = originalReplaceState(...args);
      if (shouldStartForHistoryChange(args[2])) {
        NProgress.start();
      }
      return result;
    };

    document.addEventListener("click", handleClick, true); // capture phase

    return () => {
      document.removeEventListener("click", handleClick, true);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      listening.current = false;
    };
  }, []);

  return null;
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
