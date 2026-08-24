"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/routing";

/**
 * §8: visible on every public page, above the fold, each language shown in
 * its own script. Plain links rather than a dropdown — a select needs a tap
 * and a hunt; three links are one tap and readable at a glance.
 */
export function LanguageSwitcher() {
  const active = useLocale();
  const pathname = usePathname();
  const params = useParams();

  return (
    <nav aria-label="Language" className="flex flex-wrap items-center gap-x-1 text-sm">
      {locales.map((locale, index) => (
        <span key={locale} className="flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden className="text-neutral-400">
              ·
            </span>
          ) : null}
          <Link
            href={{ pathname, params } as never}
            locale={locale}
            hrefLang={locale}
            lang={locale}
            aria-current={locale === active ? "true" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded px-2 py-1 ${
              locale === active
                ? "font-bold text-neutral-900 underline underline-offset-4"
                : "text-neutral-700 underline underline-offset-4 hover:text-neutral-900"
            }`}
          >
            {localeNames[locale as Locale]}
          </Link>
        </span>
      ))}
    </nav>
  );
}
