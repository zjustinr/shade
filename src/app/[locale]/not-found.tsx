import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function LocaleNotFound() {
  const t = await getTranslations("common");

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold">{t("notFound")}</h1>
      <p className="mt-3 text-lg">{t("notFoundBody")}</p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-[56px] items-center rounded-xl bg-neutral-900 px-6 text-lg font-semibold text-white"
      >
        {t("backHome")}
      </Link>
    </div>
  );
}
