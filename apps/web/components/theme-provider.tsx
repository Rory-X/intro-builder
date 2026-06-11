"use client";

import * as React from "react";
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps as NextThemesProviderProps,
} from "next-themes";

// next-themes renders an inline <script> to prevent theme flicker on first
// paint. React 19 warns on any <script> rendered inside a component, even
// though next-themes' use case is correct (the script runs during SSR before
// hydration). The library hasn't shipped a fix; the pragmatic workaround
// recommended by shadcn (https://github.com/shadcn-ui/ui/issues/10104) is
// to silence this specific console.error in dev. Same warning is also
// triggered by `app/layout.tsx`'s cursor-hydration-guard <Script>; React's
// didWarnScriptTags one-shot means whichever fires first eats the other,
// so this single filter covers both.
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Encountered a script tag")) {
      return;
    }
    orig.apply(console, args);
  };
}

export function ThemeProvider({
  children,
  ...props
}: React.PropsWithChildren<NextThemesProviderProps>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
