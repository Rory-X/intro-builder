import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/(app)/actions/logout";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export async function Header() {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Brand />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu email={email} name={name} signOutAction={signOutAction} />
        </div>
      </div>
    </header>
  );
}
