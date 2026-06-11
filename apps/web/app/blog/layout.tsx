import type { ReactNode } from "react";
import Link from "next/link";
import { RootProvider } from "fumadocs-ui/provider/next";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="font-semibold">intro-builder</Link>
              <Link href="/docs" className="text-muted-foreground hover:text-foreground">求职指南</Link>
              <Link href="/blog" className="text-foreground font-medium">博客</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-12">
          {children}
        </main>
      </div>
    </RootProvider>
  );
}
