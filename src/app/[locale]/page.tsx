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
  const tNav = await getTranslations("nav");

  // Each card wears the accent of the page it opens (data-page), so the home
  // page previews the colour change that follows the click.
  const cards = [
    { href: "/map", page: "map", title: tNav("map"), body: t("cardMap"), icon: "sun" },
    { href: "/corners", page: "corners", title: tNav("corners"), body: t("cardCorners"), icon: "leaf" },
    { href: "/about", page: "about", title: tNav("about"), body: t("cardAbout"), icon: "info" },
  ] as const;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <section className="rounded-3xl border border-accent-line bg-gradient-to-br from-accent-soft to-paper p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold sm:text-4xl">{t("heading")}</h1>
        <p className="mt-4 text-lg leading-relaxed">{t("intro")}</p>
        <p className="mt-3 text-lg leading-relaxed">{t("whyItMatters")}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/map"
            data-page="map"
            className="inline-flex min-h-[56px] items-center rounded-xl bg-accent px-6 text-lg font-semibold text-on-accent shadow-sm transition-colors hover:bg-accent-ink"
          >
            {t("openMap")}
          </Link>
          <Link
            href="/about"
            data-page="about"
            className="inline-flex min-h-[56px] items-center rounded-xl border-2 border-accent bg-paper px-6 text-lg font-semibold text-accent-ink transition-colors hover:bg-accent-soft"
          >
            {t("aboutLink")}
          </Link>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="explore-heading">
        <h2 id="explore-heading" className="text-2xl font-bold text-accent-ink">
          {t("exploreHeading")}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <li key={card.href} className="flex">
              <Link
                href={card.href}
                data-page={card.page}
                className="explore-card flex w-full flex-col rounded-2xl border-2 border-accent-line bg-accent-soft p-5"
              >
                <span
                  aria-hidden
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-on-accent"
                >
                  <CardIcon name={card.icon} />
                </span>
                <span className="mt-3 text-xl font-bold text-accent-ink">{card.title}</span>
                <span className="mt-1 flex-1 text-base leading-snug text-ink">{card.body}</span>
                <span
                  aria-hidden
                  className="explore-arrow mt-3 inline-block self-start text-xl font-bold text-accent"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8">
        <ShadeDisclaimer />
      </div>

      {/* §0: where the user needs an indoor cooling resource, deep-link out
          to the City's existing map. This site never presents itself as a
          directory of cooling centers. */}
      <section className="mt-8 rounded-2xl border border-accent-line bg-paper p-5">
        <h2 className="text-xl font-semibold">{t("coolingHeading")}</h2>
        <p className="mt-2 leading-relaxed">{t("coolingBody")}</p>
        <div className="mt-4">
          <CityCoolingLink />
        </div>
      </section>
    </div>
  );
}

/** Plain line icons, drawn here so they look the same on every device (emoji and symbol glyphs do not). */
function CardIcon({ name }: { name: "sun" | "leaf" | "info" }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "sun") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (name === "leaf") {
    return (
      <svg {...common}>
        <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" />
        <path d="M5 19c3-4 6-6 10-8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
