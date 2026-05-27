import Link from "next/link";
import Image from "next/image";

export function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-1.5 text-lg font-semibold tracking-tight">
      <Image
        src="/logo.png"
        alt="intro-builder"
        width={28}
        height={28}
        className="transition-transform duration-200 group-hover:scale-105"
      />
      <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
        intro-builder
      </span>
    </Link>
  );
}
