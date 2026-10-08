import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPublicCorners } from "@/lib/public-corners";
import { corsPreflight, publicCorsHeaders } from "@/lib/public-cors";
import { routing, type Locale } from "@/i18n/routing";

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("locale") ?? routing.defaultLocale;
  const locale = (routing.locales as readonly string[]).includes(requested)
    ? (requested as Locale)
    : routing.defaultLocale;

  const rows = await getPublicCorners(locale).catch(() => []);
  return NextResponse.json(rows, { headers: publicCorsHeaders });
}

export function OPTIONS() {
  return corsPreflight();
}
