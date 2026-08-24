"use client";

import { useLocale, useTranslations } from "next-intl";
import type { PublicReading } from "@/lib/public-readings";

export function ReadingCard({
  reading,
  onClose,
}: {
  reading: PublicReading;
  onClose: () => void;
}) {
  const t = useTranslations("reading");
  const locale = useLocale();

  const recorded = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(reading.recordedAt));

  return (
    <aside className="rounded-xl border border-neutral-300 p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          {reading.siteCode ? (
            <p className="text-sm text-neutral-600">
              {reading.siteCode}
              {reading.siteName ? ` · ${reading.siteName}` : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-neutral-300 px-3 font-medium"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-amber-50 p-3">
          <dt className="text-sm text-neutral-700">{t("sunTemp")}</dt>
          <dd className="text-2xl font-bold tabular-nums">{reading.sunTempF}°F</dd>
        </div>
        <div className="rounded-lg bg-blue-50 p-3">
          <dt className="text-sm text-neutral-700">{t("shadeTemp")}</dt>
          <dd className="text-2xl font-bold tabular-nums">{reading.shadeTempF}°F</dd>
        </div>
        <div className="rounded-lg bg-neutral-100 p-3">
          <dt className="text-sm text-neutral-700">{t("difference")}</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {reading.deltaF == null ? "—" : `${reading.deltaF.toFixed(1)}°F`}
          </dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-600">{t("surface")}</dt>
        <dd>{t(`surfaceType.${reading.surfaceType}` as never)}</dd>
        <dt className="text-neutral-600">{t("shadeFrom")}</dt>
        <dd>{t(`shadeSource.${reading.shadeSource}` as never)}</dd>
        <dt className="text-neutral-600">{t("recordedAt")}</dt>
        <dd>{recorded}</dd>
      </dl>

      {reading.flagged ? (
        <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          {t("flagged")}
        </p>
      ) : null}

      {reading.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reading.photoUrl}
          alt={t("photoAlt")}
          loading="lazy"
          className="mt-3 max-h-64 w-full rounded-lg object-cover"
        />
      ) : null}
    </aside>
  );
}
