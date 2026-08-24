"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useHighContrast } from "@/lib/use-high-contrast";
import { useOnlineStatus, usePendingCount } from "@/lib/use-pending-count";
import { syncPendingReadings } from "@/lib/sync";

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/field/login";
  const online = useOnlineStatus();
  const pending = usePendingCount();
  const { enabled: highContrast, toggle: toggleHighContrast } = useHighContrast();

  useEffect(() => {
    if (isLogin) return;
    // Try a sync whenever we regain connectivity or the app comes to the
    // foreground — §9. Never blocks the UI; failures just stay queued.
    const trySync = () => void syncPendingReadings();
    trySync();
    window.addEventListener("online", trySync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") trySync();
    });
    return () => window.removeEventListener("online", trySync);
  }, [isLogin]);

  if (isLogin) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-white text-neutral-900 hc:bg-black hc:text-yellow-300">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur hc:border-yellow-400 hc:bg-black">
        <Link href="/field" className="text-base font-bold">
          Cool Corners — Field
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-1 font-medium ${
              online ? "bg-green-100 text-green-800 hc:bg-black hc:text-green-300" : "bg-neutral-200 text-neutral-700 hc:bg-black hc:text-yellow-300"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${online ? "bg-green-600" : "bg-neutral-500"}`}
            />
            {online ? "Online" : "Offline"}
          </span>
          <Link
            href="/field/queue"
            className="rounded-full bg-neutral-100 px-3 py-1 font-medium hc:bg-black hc:border hc:border-yellow-400"
          >
            {pending} pending
          </Link>
          <button
            type="button"
            onClick={toggleHighContrast}
            aria-pressed={highContrast}
            className="min-h-[44px] rounded-md border border-neutral-300 px-3 py-1 font-medium hc:border-yellow-400"
          >
            {highContrast ? "HC on" : "HC off"}
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
