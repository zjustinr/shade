import { getTranslations } from "next-intl/server";

const FALLBACK_URL =
  "https://experience.arcgis.com/experience/d947122ea5e54cea8d0ece21cecb4e99";

/**
 * §0: the hard positioning rule. Where this app needs to point someone at an
 * indoor cooling resource, it deep-links to the City's existing map rather
 * than rebuilding it. The label always names it as the City's resource.
 */
export async function CityCoolingLink({ className = "" }: { className?: string }) {
  const t = await getTranslations("map");
  const url = process.env.NEXT_PUBLIC_CITY_COOLING_MAP_URL || FALLBACK_URL;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex min-h-[56px] items-center gap-2 rounded-xl border-2 border-blue-700 px-5 text-base font-semibold text-blue-800 ${className}`}
    >
      {t("cityCoolingLink")}
      <span aria-hidden>↗</span>
    </a>
  );
}
