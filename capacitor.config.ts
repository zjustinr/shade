import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS shell for the public app (map, shaded-route planner, corners, about).
 *
 * The web bundle in out/ is produced by `npm run build:ios` and is fully
 * static — the app works offline from first launch, and refreshes field
 * readings from the production API when it has a connection. The Field
 * Tool and admin are deliberately not in this app; the crew uses the
 * installable web app (see docs/ios-app-store.md for why).
 *
 * appId is the permanent App Store identity of this app. If you change it
 * after the first upload to App Store Connect, Apple treats the result as
 * a brand-new app — pick once, before the first archive.
 */
const config: CapacitorConfig = {
  appId: "org.chinatowncoolcorners.app",
  appName: "Cool Corners",
  webDir: "out",
  ios: {
    // Respect the notch/safe areas with the app's own background rather
    // than letting content slide under the status bar.
    contentInset: "always",
  },
};

export default config;
