"use client";

import { useEffect } from "react";

/**
 * next-pwa generates public/sw.js but its auto-registration is written for
 * the Pages Router's _app, which does not exist in an App Router project —
 * the worker is emitted and then never registered. Registering it here is
 * the App Router equivalent.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    // The iOS/Capacitor bundle ships no service worker — the bundle itself
    // is the offline cache — so don't request one that isn't there.
    if (process.env.NEXT_PUBLIC_STATIC_BUNDLE === "1") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // An unavailable service worker degrades the app to online-only; it
      // must never break the page for someone standing on a sidewalk.
    });
  }, []);

  return null;
}
