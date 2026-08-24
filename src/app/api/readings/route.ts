import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, readings } from "@/db";
import { classifyDelta, readingInputSchema } from "@/lib/validation";
import { requireCrewAuth } from "@/lib/require-auth";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const unauthorized = await requireCrewAuth();
  if (unauthorized) return unauthorized;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = readingInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // §4: an unpaired reading is meaningless and must not enter the dataset.
  // sunTempF/shadeTempF are already required (non-optional) in the schema,
  // so a missing pair fails validation above — this is a defensive re-check.
  if (input.sunTempF == null || input.shadeTempF == null) {
    return NextResponse.json({ error: "Both sun and shade temperatures are required." }, {
      status: 400,
    });
  }

  const { flagged, flagReason } = classifyDelta(input.sunTempF, input.shadeTempF);

  const [saved] = await db
    .insert(readings)
    .values({
      id: input.id,
      siteId: input.siteId,
      observer: input.observer,
      recordedAt: new Date(input.recordedAt),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      gpsAccuracyM: input.gpsAccuracyM ?? null,
      surfaceType: input.surfaceType,
      sunTempF: input.sunTempF,
      shadeTempF: input.shadeTempF,
      airTempF: input.airTempF ?? null,
      shadeSource: input.shadeSource,
      photoUrl: input.photoUrl ?? null,
      notes: input.notes ?? null,
      flagged,
      flagReason,
    })
    .onConflictDoUpdate({
      target: readings.id,
      set: {
        siteId: input.siteId,
        observer: input.observer,
        recordedAt: new Date(input.recordedAt),
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        gpsAccuracyM: input.gpsAccuracyM ?? null,
        surfaceType: input.surfaceType,
        sunTempF: input.sunTempF,
        shadeTempF: input.shadeTempF,
        airTempF: input.airTempF ?? null,
        shadeSource: input.shadeSource,
        photoUrl: input.photoUrl ?? null,
        notes: input.notes ?? null,
        flagged,
        flagReason,
      },
    })
    .returning({ id: readings.id, siteId: readings.siteId, flagged: readings.flagged });

  return NextResponse.json(saved, { status: 200 });
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const rows = siteId
    ? await db.select().from(readings).where(eq(readings.siteId, Number(siteId)))
    : await db.select().from(readings);

  // Public-safe projection: drop raw device GPS accuracy, keep everything a
  // map card or the admin table needs.
  const publicRows = rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    recordedAt: r.recordedAt,
    lat: r.lat,
    lng: r.lng,
    surfaceType: r.surfaceType,
    sunTempF: r.sunTempF,
    shadeTempF: r.shadeTempF,
    deltaF: r.deltaF,
    shadeSource: r.shadeSource,
    photoUrl: r.photoUrl,
    flagged: r.flagged,
    flagReason: r.flagReason,
  }));

  return NextResponse.json(publicRows);
}
