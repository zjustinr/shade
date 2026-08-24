import { defineRouting } from "next-intl/routing";

/**
 * §8: all three locales are P0. Traditional Chinese, not Simplified —
 * Chinatown's community is predominantly Cantonese/Toisanese-speaking.
 */
export const locales = ["en", "zh-Hant", "vi"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale = "en" satisfies Locale;

/** Shown in the switcher in each language's own script (§8). */
export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-Hant": "繁體中文",
  vi: "Tiếng Việt",
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Always prefix so no locale is the silent default in the URL.
  localePrefix: "always",
});
