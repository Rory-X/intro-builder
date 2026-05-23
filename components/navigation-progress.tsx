"use client";

import { useEffect, useRef } from "react";
import NProgress from "nprogress";

/**
 * Top progress bar + spinner using NProgress.
 * Detects navigation by monkey-patching history.pushState/replaceState
 * (which Next.js App Router uses under the hood).
 */

// Configure NProgress once
NProgress.configure({
  showSpinner: true,
  minimum: 0.1,
  trickleSpeed: 200,
  speed: 300,
});

export function NavigationProgress() {
  const isPatched = useRef(false);

  useEffect(() => {
    if (isPatched.current) return;
    isPatched.current = true;

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    let currentUrl = location.href;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleComplete() {
      // Ensure the progress bar is visible for at least 300ms,
      // then wait for browser idle (React rendering finished)
      if (doneTimer) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        if ("requestIdleCallback" in window) {
          requestIdleCallback(() => NProgress.done(), { timeout: 1000 });
        } else {
          NProgress.done();
        }
      }, 300);
    }

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      const result = originalPushState(...args);
      const newUrl = args[2]?.toString();
      if (newUrl && new URL(newUrl, location.origin).href !== currentUrl) {
        currentUrl = new URL(newUrl, location.origin).href;
        NProgress.start();
        scheduleComplete();
      }
      return result;
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      const result = originalReplaceState(...args);
      const newUrl = args[2]?.toString();
      if (newUrl && new URL(newUrl, location.origin).href !== currentUrl) {
        currentUrl = new URL(newUrl, location.origin).href;
        NProgress.start();
        scheduleComplete();
      }
      return result;
    };

    const handlePopState = () => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        NProgress.start();
        scheduleComplete();
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", handlePopState);
      if (doneTimer) clearTimeout(doneTimer);
      isPatched.current = false;
    };
  }, []);

  return null; // NProgress manages its own DOM
}
