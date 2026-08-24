import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShadeDisclaimer } from "@/components/shade-disclaimer";
import { CityCoolingLink } from "@/components/city-cooling-link";
import type { ShadeIndex } from "@/lib/shade-index";
import { CHINATOWN_BBOX } from "@/lib/chinatown";
import {
  CROWN_ALLOMETRY_NOTE,
  DEFAULT_CROWN_RADIUS_M,
  DEFAULT_TREE_HEIGHT_M,
} from "@/lib/tree-allometry";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("heading") };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");

  const index = JSON.parse(
    await readFile(join(process.cwd(), "public", "data", "shade", "index.json"), "utf8"),
  ) as ShadeIndex;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold">{t("heading")}</h1>

      <Section title={t("whatHeading")}>
        <p>{t("whatBody")}</p>
      </Section>

      <Section title={t("gapHeading")}>
        <p>{t("gapBody")}</p>
        <div className="mt-4">
          <CityCoolingLink />
        </div>
      </Section>

      <Section title={t("methodHeading")}>
        <p>{t("methodBody")}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <Stat label="Buildings modelled" value={String(index.buildingsTotal - index.buildingsSkippedNoHeight)} />
          <Stat label="Buildings skipped" value={String(index.buildingsSkippedNoHeight)} />
          <Stat label="Trees modelled" value={String(index.treesTotal)} />
          <Stat label="Time step" value={`${index.stepMinutes} min`} />
          <Stat label="Hours covered" value={`${index.startHour}:00–${index.endHour}:00`} />
          <Stat label="Dates precomputed" value={String(index.dates.length)} />
        </dl>
        <p className="mt-3 text-sm text-neutral-600">
          Bounding box {CHINATOWN_BBOX.west}, {CHINATOWN_BBOX.south} to {CHINATOWN_BBOX.east},{" "}
          {CHINATOWN_BBOX.north}. Shade last computed{" "}
          {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
            new Date(index.generatedAt),
          )}
          .
        </p>
      </Section>

      <Section title={t("readingsHeading")}>
        <p>{t("readingsBody")}</p>
      </Section>

      <Section title={t("limitsHeading")}>
        <p>{t("limitsIntro")}</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>{t("limitTerrain")}</li>
          <li>{t("limitStructures")}</li>
          <li>{t("limitTrees")}</li>
          <li>{t("limitTreeData")}</li>
          {/* §14: log the skipped-building count rather than quietly
              guessing a height for them. */}
          <li>
            {t("limitHeights", {
              skipped: index.buildingsSkippedNoHeight,
              total: index.buildingsTotal,
            })}
          </li>
          <li>{t("limitSeason")}</li>
        </ul>
        <p className="mt-3 text-sm text-neutral-600">
          {CROWN_ALLOMETRY_NOTE} Where trunk diameter is missing, a {DEFAULT_CROWN_RADIUS_M} m
          crown radius and {DEFAULT_TREE_HEIGHT_M} m height are assumed.
        </p>
        <div className="mt-4">
          <ShadeDisclaimer />
        </div>
      </Section>

      <Section title={t("sourcesHeading")}>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            {t("sourceTrees")} —{" "}
            <a
              href="https://data.boston.gov/dataset/bprd-trees"
              className="underline underline-offset-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              City of Boston Open Data: BPRD Trees
            </a>
          </li>
          <li>
            {t("sourceBuildings")} —{" "}
            <a
              href="https://data.boston.gov/dataset/boston-buildings-with-roof-breaks"
              className="underline underline-offset-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              City of Boston Open Data: Buildings with Roof Breaks
            </a>
          </li>
          <li>
            {t("sourceCity")} —{" "}
            <a
              href={
                process.env.NEXT_PUBLIC_CITY_COOLING_MAP_URL ||
                "https://experience.arcgis.com/experience/d947122ea5e54cea8d0ece21cecb4e99"
              }
              className="underline underline-offset-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              City of Boston Office of Emergency Management
            </a>
          </li>
          <li>Basemap — OpenFreeMap, © OpenStreetMap contributors</li>
        </ul>
      </Section>

      <Section title={t("privacyHeading")}>
        <p>{t("privacyBody")}</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="mt-2 leading-relaxed">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
