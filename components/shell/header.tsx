import Link from "next/link";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/(app)/actions/logout";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";

export async function Header() {
  const session = await auth();
  const email = session?.user?.email ?? null;
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Brand />
          <nav className="hidden items-center gap-4 text-sm text-muted-foreground md:flex">
            <Link href="/#features" className="hover:text-foreground">特性</Link>
            <Link href="/#templates" className="hover:text-foreground">模板</Link>
          </nav>
        </div>
        <UserMenu email={email} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
