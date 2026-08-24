import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import QRCode from "qrcode";
import type { FeatureCollection } from "geojson";
import { BLOCKS, blockCentre, findBlock } from "@/lib/blocks";
import { ShadeSvg } from "@/lib/shade-svg";
import { nearestShadeDate, type ShadeIndex } from "@/lib/shade-index";
import { locales } from "@/i18n/routing";

/** The three times a paper sheet is worth carrying (§7). */
const PRINT_TIMES = [
  { file: "0900", key: "morning" },
  { file: "1200", key: "midday" },
  { file: "1500", key: "afternoon" },
] as const;

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    BLOCKS.map((block) => ({ locale, block: block.code })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; block: string }>;
}): Promise<Metadata> {
  const { locale, block } = await params;
  const t = await getTranslations({ locale, namespace: "print" });
  const found = findBlock(block);
  return {
    title: `${t("heading")} — ${found?.nameEn ?? block}`,
    robots: { index: false, follow: false },
  };
}

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readFile(join(process.cwd(), ...segments), "utf8")) as T;
}

export default async function PrintBlockPage({
  params,
}: {
  params: Promise<{ locale: string; block: string }>;
}) {
  const { locale, block: blockCode } = await params;
  setRequestLocale(locale);

  const block = findBlock(blockCode);
  if (!block) notFound();

  const t = await getTranslations("print");

  const index = await readJson<ShadeIndex>("public", "data", "shade", "index.json");
  const buildings = await readJson<FeatureCollection>("public", "data", "buildings.geojson");
  const dateKey = nearestShadeDate(new Date(), index).dateKey;

  const slots = await Promise.all(
    PRINT_TIMES.map(async (time) => ({
      ...time,
      shade: await readJson<FeatureCollection>(
        "public",
        "data",
        "shade",
        dateKey,
        `${time.file}.geojson`,
      ),
    })),
  );

  // The QR points at the block's own view of the live map, so a sign on a
  // pole leads to the same place the sheet shows (§7, and the v2 QR idea).
  const centre = blockCentre(block);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://chinatown-cool-corners.vercel.app";
  const mapUrl = `${siteUrl}/${locale}/map?lat=${centre.lat.toFixed(5)}&lng=${centre.lng.toFixed(5)}&block=${block.code}`;
  const qrSvg = await QRCode.toString(mapUrl, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
  });

  // All three languages on one sheet: a printed page cannot be switched.
  const disclaimers = await Promise.all(
    locales.map(async (loc) => ({
      locale: loc,
      text: (await getTranslations({ locale: loc, namespace: "disclaimer" }))("short"),
    })),
  );
  const timeLabels = await Promise.all(
    locales.map(async (loc) => {
      const tp = await getTranslations({ locale: loc, namespace: "print" });
      return {
        locale: loc,
        morning: tp("morning"),
        midday: tp("midday"),
        afternoon: tp("afternoon"),
        scan: tp("scanForMore"),
      };
    }),
  );

  return (
    <div className="print-sheet mx-auto max-w-3xl px-6 py-6 text-neutral-900">
      <header className="border-b-2 border-neutral-900 pb-3">
        <h1 className="text-2xl font-bold">{block.nameEn}</h1>
        <p className="text-sm">
          {t("heading")} ·{" "}
          {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(
            new Date(`${index.dates.find((d) => d.dateKey === dateKey)?.date}T12:00:00Z`),
          )}
        </p>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {slots.map((slot) => (
          <figure key={slot.file}>
            <ShadeSvg
              shade={slot.shade}
              buildings={buildings}
              bbox={block.bbox}
              label={`${block.nameEn} ${slot.key}`}
            />
            <figcaption className="mt-1 text-center text-sm leading-tight">
              {timeLabels.map((labels) => (
                <span key={labels.locale} lang={labels.locale} className="block font-semibold">
                  {labels[slot.key]}
                </span>
              ))}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-4 border-t border-neutral-400 pt-3">
        <div className="w-24 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div className="text-xs leading-snug">
          {timeLabels.map((labels) => (
            <p key={labels.locale} lang={labels.locale} className="font-semibold">
              {labels.scan}
            </p>
          ))}
          <p className="mt-1 break-all text-neutral-600">{mapUrl}</p>
        </div>
      </div>

      {/* §6: the disclaimer travels with the sheet, in all three languages. */}
      <div className="mt-3 border-t border-neutral-400 pt-2 text-[10px] leading-snug">
        {disclaimers.map((d) => (
          <p key={d.locale} lang={d.locale}>
            {d.text}
          </p>
        ))}
        <p className="mt-1 text-neutral-600">
          Shade data: City of Boston Open Data (buildings, street trees). Chinatown Cool Corners.
        </p>
      </div>

      <div className="mt-4 print:hidden">
        <p className="text-sm text-neutral-600">
          Use your browser&apos;s Print command. This sheet is laid out for one page.
        </p>
      </div>
    </div>
  );
}
