import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const tSite = await getTranslations("site");

  const links = [
    { href: "/", label: t("home") },
    { href: "/map", label: t("map") },
    { href: "/corners", label: t("corners") },
    { href: "/about", label: t("about") },
  ] as const;

  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold">
          {tSite("name")}
        </Link>
        {/* Language switcher sits in the header so it is above the fold on
            every public page, per §8. */}
        <LanguageSwitcher />
        <nav aria-label="Main" className="flex w-full flex-wrap gap-x-4 gap-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-[44px] items-center text-base underline-offset-4 hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
