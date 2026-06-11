"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  children: React.ReactNode;
  className?: string;
};

export function ResumeCardLink({ href, children, className }: Props) {
  const [isOpening, setIsOpening] = useState(false);

  return (
    <Link
      href={href}
      aria-busy={isOpening}
      className={cn("relative block", className)}
      onClick={() => setIsOpening(true)}
    >
      {children}
      {isOpening && (
        <span className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/70 text-sm font-medium text-foreground backdrop-blur-sm">
          <span className="inline-flex items-center gap-2 rounded-full bg-popover px-3 py-1.5 shadow-sm ring-1 ring-border">
            <Loader2 className="h-4 w-4 animate-spin" />
            打开中…
          </span>
        </span>
      )}
    </Link>
  );
}
