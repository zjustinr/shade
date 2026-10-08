/**
 * CORS headers for the two read-only public endpoints the iOS app calls.
 *
 * The native bundle is static files served from capacitor://localhost, so
 * its requests arrive cross-origin and the browser enforces CORS. A
 * wildcard is correct here, not a shortcut: these endpoints serve exactly
 * the projection the public web map already shows to anyone, carry no
 * cookies, and accept no writes. Never copy these headers onto a write
 * endpoint or anything that reads auth.
 */
export const publicCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: publicCorsHeaders });
}
