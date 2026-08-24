import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, CREW_COOKIE, tokenFor } from "@/lib/auth";

// Gate the crew field tool and the lead-only admin console behind a shared
// passcode (§10 Security: httpOnly cookie, no OAuth — six-person project).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/field") && !pathname.startsWith("/field/login")) {
    if (!isAuthorized(request, CREW_COOKIE, process.env.CREW_PASSCODE)) {
      return redirectToLogin(request, "/field/login");
    }
  }

  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    if (!isAuthorized(request, ADMIN_COOKIE, process.env.ADMIN_PASSCODE)) {
      return redirectToLogin(request, "/admin/login");
    }
  }

  return NextResponse.next();
}

function isAuthorized(
  request: NextRequest,
  cookieName: string,
  passcode: string | undefined,
): boolean {
  if (!passcode) return false;
  const cookie = request.cookies.get(cookieName)?.value;
  return cookie === tokenFor(passcode);
}

function redirectToLogin(request: NextRequest, loginPath: string) {
  const url = request.nextUrl.clone();
  const next = url.pathname + url.search;
  url.pathname = loginPath;
  url.search = "";
  if (next !== loginPath) {
    url.searchParams.set("next", next);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/field/:path*", "/admin/:path*"],
};
