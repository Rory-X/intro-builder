import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Ma_Shan_Zheng } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import { Analytics } from "@vercel/analytics/react";
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

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const maShanZheng = Ma_Shan_Zheng({
  variable: "--font-display-cn",
  weight: "400",
  subsets: ["latin"],
  preload: false,
});

// Sarasa Fixed SC Regular subset 到 GB2312 字符集（约 7500 字 + Latin），
// woff2 ~1.5MB。mono 字体被选时才加载（display: swap 让首屏不阻塞）。
// 见 lib/font-map.ts —— mono fallback 链优先这个 web font，让"等宽体"
// 在中文环境下真正等宽（macOS / Windows 都没有原生中文等宽字体）。
const sarasaMono = localFont({
  src: "../public/fonts/sarasa-fixed-sc-regular.woff2",
  variable: "--font-sarasa-mono",
  weight: "400",
  display: "swap",
  preload: false,
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
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${maShanZheng.variable} ${sarasaMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NavigationProgress />
          {children}
          <Toaster />
        </ThemeProvider>
        <Analytics />
        {process.env.NODE_ENV === "development" && (
          <Script
            id="cursor-hydration-guard"
            strategy="beforeInteractive"
          >
            {cursorHydrationGuardScript}
          </Script>
        )}
      </body>
    </html>
  );
}
