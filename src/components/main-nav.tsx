"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { pageThemeFor, type PageTheme } from "./theme-shell";

export type NavItem = { href: "/" | "/map" | "/corners" | "/about"; label: string };

/**
 * Each link carries its own page's accent (data-page on the link), so the
 * nav previews where each click leads, and the current page is shown by a
 * filled pill and aria-current, never by colour alone.
 */
export function MainNav({ items }: { items: NavItem[] }) {
  const current = pageThemeFor(usePathname());

  return (
    <nav aria-label="Main" className="flex w-full flex-wrap gap-x-2 gap-y-1">
      {items.map((item) => {
        const page: PageTheme = item.href === "/" ? "home" : (item.href.slice(1) as PageTheme);
        const active = page === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            data-page={page}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-base transition-colors ${
              active
                ? "border-accent bg-accent font-semibold text-on-accent"
                : "border-transparent text-ink hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
