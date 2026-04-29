import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-1.5 text-lg font-semibold tracking-tight">
      <span
        aria-hidden
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-sm transition-transform duration-200 group-hover:scale-105"
      >
        ib
      </span>
      <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
        intro-builder
      </span>
    </Link>
  );
}
