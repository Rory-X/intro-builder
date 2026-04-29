import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-1 text-lg font-semibold tracking-tight">
      <span aria-hidden className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">ib</span>
      <span>intro-builder</span>
    </Link>
  );
}
