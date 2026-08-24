import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlProxy from "next-intl/middleware";
import { ADMIN_COOKIE, CREW_COOKIE, tokenFor } from "@/lib/auth";
import { routing } from "@/i18n/routing";

const intlProxy = createIntlProxy(routing);

/**
 * Two jobs in one file, because Next allows only one proxy:
 *  - gate /field and /admin behind a shared passcode (§10 Security)
 *  - hand every public route to next-intl for locale routing (§8)
 *
 * The crew tools are deliberately English-only: they are an internal
 * instrument for six people, not a public page, and §8's trilingual
 * requirement is about public reach.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/field")) {
    return pathname.startsWith("/field/login")
      ? NextResponse.next()
      : (guard(request, CREW_COOKIE, process.env.CREW_PASSCODE, "/field/login") ??
          NextResponse.next());
  }

  if (pathname.startsWith("/admin")) {
    return pathname.startsWith("/admin/login")
      ? NextResponse.next()
      : (guard(request, ADMIN_COOKIE, process.env.ADMIN_PASSCODE, "/admin/login") ??
          NextResponse.next());
  }

  return intlProxy(request);
}

function guard(
  request: NextRequest,
  cookieName: string,
  passcode: string | undefined,
  loginPath: string,
): NextResponse | null {
  if (passcode && request.cookies.get(cookieName)?.value === tokenFor(passcode)) {
    return null;
  }

  const url = request.nextUrl.clone();
  const next = url.pathname + url.search;
  url.pathname = loginPath;
  url.search = "";
  if (next !== loginPath) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals, the API, and static files. The API is
  // excluded on purpose: those routes do their own auth check and must not
  // be locale-rewritten.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
