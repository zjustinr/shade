import { NextResponse } from "next/server";
import { getPublicReadings } from "@/lib/public-readings";
import { corsPreflight, publicCorsHeaders } from "@/lib/public-cors";

/**
 * The same public-safe projection the web map renders server-side, exposed
 * for clients that cannot server-render: the iOS app ships the map as a
 * static bundle and refreshes its validation points from here at runtime.
 */
export const revalidate = 300;

export async function GET() {
  const rows = await getPublicReadings().catch(() => []);
  return NextResponse.json(rows, { headers: publicCorsHeaders });
}

export function OPTIONS() {
  return corsPreflight();
}
