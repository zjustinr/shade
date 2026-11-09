"use client";

import { usePathname } from "@/i18n/navigation";

/**
 * Wraps the public site chrome and tells the stylesheet which page you are
 * on, so the accent colours (globals.css, [data-page]) can shift as you move
 * around. usePathname here is locale-free ("/map", not "/en/map"), and runs
 * during server rendering too, so there is no flash of the wrong colours.
 */
const THEMED = ["map", "corners", "about", "print"] as const;
export type PageTheme = "home" | (typeof THEMED)[number];

export function pageThemeFor(pathname: string): PageTheme {
  const first = pathname.split("/")[1] ?? "";
  return (THEMED as readonly string[]).includes(first) ? (first as PageTheme) : "home";
}

export function ThemeShell({ children }: { children: React.ReactNode }) {
  const page = pageThemeFor(usePathname());
  return (
    <div data-page={page} className="site-shell flex min-h-full flex-1 flex-col">
      {children}
    </div>
  );
}
