import { desc, eq, isNotNull } from "drizzle-orm";
import { db, readings, sites } from "@/db";

/**
 * What the public map is allowed to see. Deliberately narrow: no observer
 * name, no GPS accuracy, no free-text notes (§10 Privacy — observer names
 * are first-name-only in the database and still have no business on a
 * public map).
 */
export type PublicReading = {
  id: string;
  siteCode: string | null;
  siteName: string | null;
  lat: number;
  lng: number;
  recordedAt: string;
  surfaceType: string;
  shadeSource: string;
  sunTempF: number;
  shadeTempF: number;
  deltaF: number | null;
  photoUrl: string | null;
  flagged: boolean;
};

export async function getPublicReadings(): Promise<PublicReading[]> {
  const rows = await db
    .select({ reading: readings, site: sites })
    .from(readings)
    .leftJoin(sites, eq(readings.siteId, sites.id))
    .where(isNotNull(readings.siteId))
    .orderBy(desc(readings.recordedAt));

  return rows.flatMap(({ reading, site }) => {
    // Fall back to the planned site position when the device had no GPS fix;
    // a reading with neither cannot be placed and is left off the map.
    const lat = reading.lat ?? site?.lat;
    const lng = reading.lng ?? site?.lng;
    if (lat == null || lng == null) return [];

    return [
      {
        id: reading.id,
        siteCode: site?.code ?? null,
        siteName: site?.nameEn ?? null,
        lat,
        lng,
        recordedAt: reading.recordedAt.toISOString(),
        surfaceType: reading.surfaceType,
        shadeSource: reading.shadeSource,
        sunTempF: reading.sunTempF,
        shadeTempF: reading.shadeTempF,
        deltaF: reading.deltaF,
        photoUrl: reading.photoUrl,
        flagged: reading.flagged,
      },
    ];
  });
}
