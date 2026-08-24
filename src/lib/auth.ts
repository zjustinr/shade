import { createHash, timingSafeEqual } from "node:crypto";

export const CREW_COOKIE = "shade_crew_auth";
export const ADMIN_COOKIE = "shade_admin_auth";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days — a field season plus buffer

/** Derives a stable, non-reversible session token from a shared passcode. */
export function tokenFor(passcode: string): string {
  return createHash("sha256").update(passcode).digest("hex");
}

export function passcodeMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE_SECONDS,
};
