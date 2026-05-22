import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { NavigationProgress } from "@/components/navigation-progress";
import { cursorHydrationGuardScript } from "@/lib/cursor-hydration-guard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "intro-builder", template: "%s · intro-builder" },
  description: "面向互联网求职者的在线简历排版工具：结构化编辑、自动保存、一键导出 PDF。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NavigationProgress />
          {children}
          <Toaster />
        </ThemeProvider>
        {process.env.NODE_ENV === "development" && (
          <Script
            id="cursor-hydration-guard"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: cursorHydrationGuardScript }}
          />
        )}
      </body>
    </html>
  );
}
