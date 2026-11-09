import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteFooter() {
  const t = await getTranslations("map");
  const tNav = await getTranslations("nav");

  return (
    <footer className="mt-12 border-t border-accent-line bg-accent-soft px-4 py-6 text-sm text-accent-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        {/* §5: every public view carries a visible credit line naming
            City of Boston Open Data and the basemap provider. */}
        <p>{t("attribution")}</p>
        <Link href="/about" className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4">
          {tNav("about")}
        </Link>
      </div>
    </footer>
  );
}
