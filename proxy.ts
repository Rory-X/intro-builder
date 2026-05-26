import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PROTECTED = [/^\/dashboard/, /^\/resume\/[^/]+\/edit/, /^\/resume\/[^/]+\/preview/, /^\/templates(\/|$)/];

const DEV_BYPASS =
  process.env.NODE_ENV === "development" && process.env.AUTH_DEV_BYPASS === "1";

const protectedHandler = auth((req) => {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED.some((re) => re.test(pathname));
  if (needsAuth && !req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export default DEV_BYPASS
  ? (_req: NextRequest) => NextResponse.next()
  : protectedHandler;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|fonts).*)"],
};
