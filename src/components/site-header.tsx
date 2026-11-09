import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { MainNav, type NavItem } from "./main-nav";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const tSite = await getTranslations("site");

  const links: NavItem[] = [
    { href: "/", label: t("home") },
    { href: "/map", label: t("map") },
    { href: "/corners", label: t("corners") },
    { href: "/about", label: t("about") },
  ];

  return (
    <header className="border-b border-accent-line border-t-[6px] border-t-accent bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 text-xl font-extrabold text-accent-ink">
          <Logo className="h-12 w-12 shrink-0" />
          {tSite("name")}
        </Link>
        {/* Language switcher sits in the header so it is above the fold on
            every public page, per §8. */}
        <LanguageSwitcher />
        <MainNav items={links} />
      </div>
    </header>
  );
}
