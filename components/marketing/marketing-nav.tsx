"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, LogOut, Settings } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV_LINKS = [
  { label: "产品功能", href: "#features" },
  { label: "模板", href: "#templates" },
  { label: "定价", href: "#pricing" },
  { label: "更新日志", href: "#changelog" },
];

interface MarketingNavProps {
  email?: string | null;
  name?: string | null;
  signOutAction?: () => Promise<void>;
}

export function MarketingNav({ email, name, signOutAction }: MarketingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const isLoggedIn = !!email;

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-4 left-1/2 z-50 -translate-x-1/2 flex w-[calc(100%-2rem)] max-w-4xl items-center justify-between rounded-full border px-3 py-2 transition-all duration-300 md:px-4 ${
        scrolled
          ? "border-border/60 bg-background/80 shadow-lg shadow-black/[0.03] backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-background/40 backdrop-blur-md"
      }`}
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-[10px] font-extrabold text-background shadow-sm">
          ib
        </span>
        <span className="hidden text-sm font-bold tracking-tight sm:inline">
          intro-builder
        </span>
      </Link>

      {/* Nav links */}
      <div className="hidden items-center gap-0.5 md:flex">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {link.label}
          </a>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isLoggedIn ? (
          <>
            <Link href="/dashboard">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-sm font-medium"
              >
                控制台
              </Button>
            </Link>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger
                className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="用户菜单"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs font-semibold">
                    {name ? name.charAt(0).toUpperCase() : email.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-52 p-0">
                <div className="border-b px-3 py-2.5">
                  {name && <div className="text-sm font-medium">{name}</div>}
                  <div className="truncate text-xs text-muted-foreground">
                    {email}
                  </div>
                </div>
                <div className="p-1">
                  <Link
                    href="/dashboard"
                    onClick={() => setPopoverOpen(false)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Settings className="h-4 w-4" />
                    控制台
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setPopoverOpen(false)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Settings className="h-4 w-4" />
                    账户设置
                  </Link>
                  {signOutAction && (
                    <button
                      type="button"
                      onClick={() => {
                        setPopoverOpen(false);
                        void signOutAction();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </>
        ) : (
          <>
            <Link href="/login">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-sm font-medium"
              >
                登录
              </Button>
            </Link>
            <Link href="/login">
              <Button
                size="sm"
                className="rounded-full gap-1.5 text-sm font-semibold shadow-md shadow-primary/20"
              >
                免费开始
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
