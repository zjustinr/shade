import { db, coolingCorners } from "@/db";
import type { Locale } from "@/i18n/routing";

export type PublicCorner = {
  id: number;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  hasSeating: boolean;
  installedOn: string | null;
  photoUrl: string | null;
};

/**
 * §8: corner names and descriptions are translated in the database, so pick
 * the column for the active locale and fall back to English where a
 * translation has not been filled in yet.
 */
export async function getPublicCorners(locale: Locale): Promise<PublicCorner[]> {
  const rows = await db.select().from(coolingCorners).orderBy(coolingCorners.id);

  return rows.map((row) => ({
    id: row.id,
    name: pick(locale, row.nameEn, row.nameZh, row.nameVi) ?? row.nameEn,
    description: pick(locale, row.descriptionEn, row.descriptionZh, row.descriptionVi),
    lat: row.lat,
    lng: row.lng,
    hasSeating: row.hasSeating ?? false,
    installedOn: row.installedOn,
    photoUrl: row.photoUrl,
  }));
}

function pick(
  locale: Locale,
  en: string | null,
  zh: string | null,
  vi: string | null,
): string | null {
  if (locale === "zh-Hant") return zh ?? en;
  if (locale === "vi") return vi ?? en;
  return en;
}
