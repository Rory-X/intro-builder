import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/(app)/actions/logout";
import { MarketingNav } from "@/components/marketing/marketing-nav";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;

  return (
    <>
      <MarketingNav email={email} name={name} signOutAction={signOutAction} hideNavLinks fullWidth />
      {/* Spacer for fixed nav */}
      <div className="h-16" />
      {children}
    </>
  );
}
