import { cookies } from "next/headers";
import { ADMIN_COOKIE, CREW_COOKIE, tokenFor } from "@/lib/auth";

/**
 * API routes are not covered by proxy.ts's matcher (it only guards page
 * routes), so write endpoints must check the passcode cookie themselves.
 */
async function isAuthorized(cookieName: string, passcode: string | undefined) {
  if (!passcode) return false;
  const store = await cookies();
  return store.get(cookieName)?.value === tokenFor(passcode);
}

export async function requireCrewAuth(): Promise<Response | null> {
  const ok = await isAuthorized(CREW_COOKIE, process.env.CREW_PASSCODE);
  return ok ? null : new Response("Unauthorized", { status: 401 });
}

export async function requireAdminAuth(): Promise<Response | null> {
  const ok = await isAuthorized(ADMIN_COOKIE, process.env.ADMIN_PASSCODE);
  return ok ? null : new Response("Unauthorized", { status: 401 });
}
