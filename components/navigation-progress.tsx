"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * A thin top progress bar that shows during page navigation.
 * Works by monkey-patching history.pushState/replaceState (which Next.js
 * App Router uses under the hood) and listening for popstate events.
 */

// ─── Global progress store (singleton across all instances) ────────

let progress = 0;
const listeners = new Set<() => void>();
let animationTimer: ReturnType<typeof setTimeout> | null = null;
let completeTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false; // Skip events until hydration is complete

function getProgress() {
  return progress;
}

function getServerProgress() {
  return 0; // Always 0 on server
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit() {
  for (const fn of listeners) fn();
}

function startProgress() {
  if (!hydrated) return; // Don't start during hydration

  if (completeTimer) { clearTimeout(completeTimer); completeTimer = null; }
  if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }

  progress = 20;
  emit();

  // Trickle: simulate slow progress
  animationTimer = setTimeout(() => {
    if (progress > 0 && progress < 90) { progress = 40; emit(); }
  }, 200);
  setTimeout(() => {
    if (progress > 0 && progress < 90) { progress = 60; emit(); }
  }, 500);
  setTimeout(() => {
    if (progress > 0 && progress < 90) { progress = 80; emit(); }
  }, 1500);
}

function completeProgress() {
  if (!hydrated) return;
  if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }

  progress = 100;
  emit();

  completeTimer = setTimeout(() => {
    progress = 0;
    emit();
    completeTimer = null;
  }, 300);
}

export function NavigationProgress() {
  const currentProgress = useSyncExternalStore(subscribe, getProgress, getServerProgress);
  const isPatched = useRef(false);

  useEffect(() => {
    // Mark hydration complete after first effect runs
    hydrated = true;

    if (isPatched.current) return;
    isPatched.current = true;

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    let currentUrl = location.href;

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      const newUrl = args[2]?.toString();
      const result = originalPushState(...args);
      // Only show progress for actual URL changes
      if (newUrl && new URL(newUrl, location.origin).href !== currentUrl) {
        startProgress();
        currentUrl = new URL(newUrl, location.origin).href;
        requestAnimationFrame(() => completeProgress());
      }
      return result;
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      const newUrl = args[2]?.toString();
      const result = originalReplaceState(...args);
      if (newUrl && new URL(newUrl, location.origin).href !== currentUrl) {
        startProgress();
        currentUrl = new URL(newUrl, location.origin).href;
        requestAnimationFrame(() => completeProgress());
      }
      return result;
    };

    const handlePopState = () => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        startProgress();
        requestAnimationFrame(() => completeProgress());
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", handlePopState);
      isPatched.current = false;
    };
  }, []);

  if (currentProgress === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5">
      <div
        className="h-full bg-primary shadow-[0_0_8px] shadow-primary/50"
        style={{
          width: `${currentProgress}%`,
          opacity: currentProgress >= 100 ? 0 : 1,
          transition: currentProgress === 0
            ? "none"
            : currentProgress >= 100
              ? "width 150ms ease-out, opacity 200ms ease-in 50ms"
              : "width 300ms ease-out",
        }}
      />
    </div>
  );
}
