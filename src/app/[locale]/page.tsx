import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CityCoolingLink } from "@/components/city-cooling-link";
import { ShadeDisclaimer } from "@/components/shade-disclaimer";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold sm:text-4xl">{t("heading")}</h1>
      <p className="mt-4 text-lg leading-relaxed">{t("intro")}</p>
      <p className="mt-3 text-lg leading-relaxed">{t("whyItMatters")}</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/map"
          className="inline-flex min-h-[56px] items-center rounded-xl bg-neutral-900 px-6 text-lg font-semibold text-white"
        >
          {t("openMap")}
        </Link>
        <Link
          href="/about"
          className="inline-flex min-h-[56px] items-center rounded-xl border border-neutral-300 px-6 text-lg font-semibold"
        >
          {t("aboutLink")}
        </Link>
      </div>

      <div className="mt-8">
        <ShadeDisclaimer />
      </div>

      {/* §0: where the user needs an indoor cooling resource, deep-link out
          to the City's existing map. This site never presents itself as a
          directory of cooling centers. */}
      <section className="mt-8 rounded-xl border border-neutral-200 p-5">
        <h2 className="text-xl font-semibold">{t("coolingHeading")}</h2>
        <p className="mt-2 leading-relaxed">{t("coolingBody")}</p>
        <div className="mt-4">
          <CityCoolingLink />
        </div>
      </section>
    </div>
  );
}
