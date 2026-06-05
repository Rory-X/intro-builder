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
      {/* Spacer for fixed nav —— print:hidden：PDF 导出走 print 媒体时隐藏。否则这
          64px 会把首个整页 .pdf-page（break-inside:avoid，不可拆）挤到第 2 页，
          留下一张空白首页。屏幕预览仍需它给 fixed nav 占位。 */}
      <div className="h-16 print:hidden" />
      {children}
    </>
  );
}
