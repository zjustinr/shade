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
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // An unavailable service worker degrades the app to online-only; it
      // must never break the page for someone standing on a sidewalk.
    });
  }, []);

  return null;
}
