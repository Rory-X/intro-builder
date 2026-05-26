import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/(app)/actions/logout";
import { MarketingNav } from "@/components/marketing/marketing-nav";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;

  return (
    <>
      <MarketingNav email={email} name={name} signOutAction={signOutAction} />
      <main className="flex-1">{children}</main>
    </>
  );
}
