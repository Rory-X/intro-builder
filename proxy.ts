import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PROTECTED = [/^\/dashboard/, /^\/resume\/[^/]+\/edit/, /^\/resume\/[^/]+\/preview/];

export default auth((req) => {
  const { pathname, searchParams } = req.nextUrl;
  const needsAuth = PROTECTED.some((re) => re.test(pathname));

  // Allow remote PDF service to access preview with a signed token
  // (token validation happens in the page component itself)
  if (needsAuth && !req.auth) {
    const isPdfWithToken =
      /^\/resume\/[^/]+\/preview/.test(pathname) &&
      searchParams.get("_pdf") === "1" &&
      searchParams.has("_token");

    if (isPdfWithToken) {
      return NextResponse.next();
    }

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
