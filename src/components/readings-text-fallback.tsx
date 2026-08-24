import { getLocale, getTranslations } from "next-intl/server";
import type { PublicReading } from "@/lib/public-readings";

/**
 * §10 Accessibility: "The map must have a non-map fallback: a text list of
 * sites with their readings." Rendered server-side as a plain table so it
 * works with no JavaScript, in a screen reader, and at 200% zoom.
 */
export async function ReadingsTextFallback({ readings }: { readings: PublicReading[] }) {
  const t = await getTranslations("map");
  const tReading = await getTranslations("reading");
  const locale = await getLocale();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    }).format(new Date(iso));

  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold">{t("textFallbackHeading")}</h2>
      <p className="mt-1 text-neutral-700">{t("textFallbackIntro")}</p>

      {readings.length === 0 ? (
        <p className="mt-4 text-neutral-600">—</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">{t("textFallbackHeading")}</caption>
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t("layerReadings")}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  {tReading("sunTemp")}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  {tReading("shadeTemp")}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  {tReading("difference")}
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {tReading("shadeFrom")}
                </th>
                <th scope="col" className="py-2 font-semibold">
                  {tReading("recordedAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading) => (
                <tr key={reading.id} className="border-b border-neutral-200">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {reading.siteCode ?? "—"}
                    {reading.siteName ? ` · ${reading.siteName}` : ""}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{reading.sunTempF}°F</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{reading.shadeTempF}°F</td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                    {reading.deltaF == null ? "—" : `${reading.deltaF.toFixed(1)}°F`}
                  </td>
                  <td className="py-2 pr-3">
                    {tReading(`shadeSource.${reading.shadeSource}` as never)}
                  </td>
                  <td className="py-2">{formatDate(reading.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
