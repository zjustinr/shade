import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShadeMap } from "@/components/shade-map";
import { ShadeDisclaimer } from "@/components/shade-disclaimer";
import { CityCoolingLink } from "@/components/city-cooling-link";
import { ReadingsTextFallback } from "@/components/readings-text-fallback";
import { getPublicReadings } from "@/lib/public-readings";
import { getPublicCorners } from "@/lib/public-corners";
import type { ShadeIndex } from "@/lib/shade-index";
import type { Locale } from "@/i18n/routing";

/**
 * Readings arrive throughout a field campaign, so a fully static page would
 * pin the map to whatever was in the database at build time. Revalidating
 * keeps it current without paying for a server render on every visit —
 * §10 wants Lighthouse ≥90 and this has to run on a free tier.
 */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "map" });
  return { title: t("heading") };
}

export default async function MapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("map");

  const index = JSON.parse(
    await readFile(join(process.cwd(), "public", "data", "shade", "index.json"), "utf8"),
  ) as ShadeIndex;

  // An empty database is normal before the field campaign runs; the map
  // still works, it just has no validation points on it yet.
  const [readings, corners] = await Promise.all([
    getPublicReadings().catch(() => []),
    getPublicCorners(locale as Locale).catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-bold">{t("heading")}</h1>

      {/* §6/§13: permanently visible, above the map, in all three languages. */}
      <div className="mt-4">
        <ShadeDisclaimer />
      </div>

      <div className="mt-4">
        <ShadeMap index={index} readings={readings} corners={corners} />
      </div>

      <div className="mt-6">
        <CityCoolingLink />
      </div>

      {/* §10 Accessibility: the map must have a non-map fallback — a text
          list of sites with their readings. */}
      <ReadingsTextFallback readings={readings} />
    </div>
  );
}
