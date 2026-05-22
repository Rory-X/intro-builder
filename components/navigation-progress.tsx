"use client";

import { useEffect, useCallback, useRef, useSyncExternalStore } from "react";

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

function getProgress() {
  return progress;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit() {
  for (const fn of listeners) fn();
}

function startProgress() {
  if (completeTimer) { clearTimeout(completeTimer); completeTimer = null; }
  if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }

  progress = 20;
  emit();

  // Trickle: simulate slow progress
  const trickle = (target: number, delay: number) => {
    animationTimer = setTimeout(() => {
      if (progress < 90) {
        progress = target;
        emit();
      }
    }, delay);
  };

  trickle(40, 200);
  setTimeout(() => {
    if (progress < 90) { progress = 60; emit(); }
  }, 500);
  setTimeout(() => {
    if (progress < 90) { progress = 75; emit(); }
  }, 1000);
  setTimeout(() => {
    if (progress < 90) { progress = 85; emit(); }
  }, 2000);
}

function completeProgress() {
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
  const currentProgress = useSyncExternalStore(subscribe, getProgress, getProgress);
  const isPatched = useRef(false);

  useEffect(() => {
    if (isPatched.current) return;
    isPatched.current = true;

    // Monkey-patch history methods (Next.js App Router uses these)
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      startProgress();
      const result = originalPushState(...args);
      // Complete after a microtask (DOM update happens synchronously after pushState)
      requestAnimationFrame(() => {
        completeProgress();
      });
      return result;
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      // Only show progress for actual navigations, not state-only updates
      const newUrl = args[2];
      if (newUrl && newUrl !== location.href && newUrl !== location.pathname + location.search) {
        startProgress();
        const result = originalReplaceState(...args);
        requestAnimationFrame(() => {
          completeProgress();
        });
        return result;
      }
      return originalReplaceState(...args);
    };

    // Also handle browser back/forward
    const handlePopState = () => {
      startProgress();
      requestAnimationFrame(() => {
        completeProgress();
      });
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
