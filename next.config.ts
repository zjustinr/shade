import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withPWAInit from "next-pwa";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * IOS_BUILD=1 switches the build to a fully static export of the public
 * app, which scripts/build-ios.ts wraps in Capacitor for the App Store.
 * The service worker is disabled there: WKWebView does not run service
 * workers for a packaged app, and the bundle IS the offline cache.
 */
const isIosBuild = process.env.IOS_BUILD === "1";

/**
 * next-pwa hooks Next's webpack config, so the build must run with
 * --webpack (see the build script). Under Turbopack the hook simply never
 * runs: the build succeeds and silently emits no service worker at all,
 * which would leave the Field Tool with no offline support while looking
 * perfectly healthy. scripts/check-service-worker.ts fails the build if
 * that ever happens again.
 */
const withPWA = withPWAInit({
  dest: "public",
  register: false, // registered explicitly; see RegisterServiceWorker
  skipWaiting: true,
  // A service worker in dev caches stale chunks and makes HMR confusing.
  disable: process.env.NODE_ENV === "development" || isIosBuild,
  runtimeCaching: [
    {
      // Precomputed shade slots never change for a given date and time, so
      // once fetched they can be served from cache indefinitely.
      urlPattern: /\/data\/shade\/.*\.geojson$/,
      handler: "CacheFirst",
      options: {
        cacheName: "shade-slots",
        expiration: { maxEntries: 140, maxAgeSeconds: 60 * 60 * 24 * 90 },
      },
    },
    {
      // The route planner's static inputs: walking network, destinations,
      // per-edge sun exposure and the wind model + climatology. They change
      // only when the data is rebuilt, so once fetched they serve from
      // cache — which is what lets the planner work with no signal.
      urlPattern: /\/data\/(network|destinations|exposure|wind)\b.*\.(json|geojson)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "planner-data",
        expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
      },
    },
    {
      urlPattern: /\/data\/(trees|buildings)\.geojson$/,
      handler: "CacheFirst",
      options: {
        cacheName: "chinatown-basedata",
        expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
      },
    },
    {
      // §9: basemap tiles for the Chinatown view. Cached as they are used
      // rather than precached — the tiles live on a third-party host and
      // enumerating z14-z18 up front would mean thousands of requests.
      urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/,
      handler: "CacheFirst",
      options: {
        cacheName: "basemap-tiles",
        expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // §9: photos, stale-while-revalidate.
      urlPattern: /^https:\/\/.*\.public\.blob\.vercel-storage\.com\/.*/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "reading-photos",
        expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      // The site list must be readable offline. IndexedDB holds the copy the
      // Field Tool actually reads; this keeps the fetch itself from failing
      // hard on a cold start with no signal.
      urlPattern: /\/api\/(sites|coverage)$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "field-reference",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      urlPattern: /\/_next\/static\/.*/,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static",
        expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      // App shell for the crew tools and the public pages.
      urlPattern: /^https?:\/\/[^/]+\/(field|admin|en|zh-Hant|vi)(\/.*)?$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "pages",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
});

const nextConfig: NextConfig = {
  // §10 Privacy: nothing here may send user data off-origin.
  poweredByHeader: false,
  ...(isIosBuild
    ? {
        output: "export" as const,
        // Folder-per-route (en/map/index.html) so Capacitor's local file
        // server resolves extensionless navigation.
        trailingSlash: true,
      }
    : {}),
};

export default withPWA(withNextIntl(nextConfig) as never) as NextConfig;
