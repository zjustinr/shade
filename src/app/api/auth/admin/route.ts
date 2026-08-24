import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, authCookieOptions, passcodeMatches, tokenFor } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/admin");
  const expected = process.env.ADMIN_PASSCODE;

  const safeNext = next.startsWith("/admin") ? next : "/admin";
  const loginUrl = new URL("/admin/login", request.url);

  if (!expected || !passcodeMatches(passcode, expected)) {
    loginUrl.searchParams.set("error", "1");
    if (safeNext !== "/admin") loginUrl.searchParams.set("next", safeNext);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(safeNext, request.url), { status: 303 });
  response.cookies.set(ADMIN_COOKIE, tokenFor(expected), authCookieOptions);
  return response;
}
