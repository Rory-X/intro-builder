import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { docsSource } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={docsSource.pageTree}
        nav={{
          title: "intro-builder 求职指南",
          url: "/docs",
        }}
        links={[
          { text: "简历工具", url: "/" },
          { text: "博客", url: "/blog" },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
