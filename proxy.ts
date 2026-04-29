import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PROTECTED = [/^\/dashboard/, /^\/resume\/[^/]+\/edit/, /^\/resume\/[^/]+\/preview/];

export default auth((req) => {
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

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|fonts).*)"],
};
