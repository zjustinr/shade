import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authCookieOptions, CREW_COOKIE, passcodeMatches, tokenFor } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/field");
  const expected = process.env.CREW_PASSCODE;

  const safeNext = next.startsWith("/field") ? next : "/field";
  const loginUrl = new URL("/field/login", request.url);

  if (!expected || !passcodeMatches(passcode, expected)) {
    loginUrl.searchParams.set("error", "1");
    if (safeNext !== "/field") loginUrl.searchParams.set("next", safeNext);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(safeNext, request.url), { status: 303 });
  response.cookies.set(CREW_COOKIE, tokenFor(expected), authCookieOptions);
  return response;
}
