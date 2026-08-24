import { getTranslations } from "next-intl/server";
import { locales } from "@/i18n/routing";

/**
 * §6 and §13: permanently visible, in ALL THREE languages at once — not
 * merely in the active locale. Someone who reads only Vietnamese must not
 * have to change the language setting to find out that the shade shown here
 * is modelled rather than measured.
 */
export async function ShadeDisclaimer({ compact = false }: { compact?: boolean }) {
  const translations = await Promise.all(
    locales.map(async (locale) => ({
      locale,
      text: (await getTranslations({ locale, namespace: "disclaimer" }))("short"),
    })),
  );

  return (
    <aside
      className={`rounded-lg border border-amber-300 bg-amber-50 ${
        compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
      }`}
    >
      <ul className="flex flex-col gap-1">
        {translations.map(({ locale, text }) => (
          <li key={locale} lang={locale} className="leading-snug text-amber-950">
            {text}
          </li>
        ))}
      </ul>
    </aside>
  );
}
