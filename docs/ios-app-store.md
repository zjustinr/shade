# Shipping the iOS app (Capacitor → App Store)

The iOS app is the **public** app — shade map, shaded-route planner,
Cooling Corners, About, print sheets — packaged with Capacitor as a fully
static bundle that works offline from first launch and refreshes field
readings from the production API when it has a connection.

**What is deliberately not in it:** the Field Tool and admin. They need the
server (auth, sync), and a passcode-gated section inside an App Store build
invites Apple's review team to demand working credentials (Guideline 2.1).
The crew keeps using the installable web app at `/field`, which also means
crew-facing fixes ship same-day instead of waiting on App Review.

## Costs and constraints — read first

- **Apple Developer Program: US$99/year.** This is the first thing in the
  project that breaks SPEC §10's "no service requiring a credit card" rule,
  and SPEC §2 listed native apps as out of scope — shipping this is a
  deliberate scope decision, so make sure the grant reporting reflects it.
- **A Mac with Xcode 16+ is required** to build, test and upload. There is
  no way around this; everything below assumes one.
- App releases go through App Review (typically 1–2 days). The website
  stays the place where fixes land immediately.

## One-time setup (Mac)

1. Install Xcode from the App Store, then `xcode-select --install`.
2. Enroll at developer.apple.com ($99/yr). Personal enrollment is fine;
   a nonprofit fiscal sponsor can also enroll as an organization (and may
   qualify for a fee waiver — Apple waives it for nonprofits in the US).
3. Clone the repo, `npm install`.
4. **Decide the bundle id once.** `capacitor.config.ts` ships with
   `org.chinatowncoolcorners.app` as a placeholder. Whatever you pick
   becomes the app's permanent identity after the first upload — change it
   now or never. If you change it, also update `appId` there before
   `cap sync`.

## Build and run

```bash
npm run build:ios      # static export of the public app into out/
npx cap sync ios       # copy out/ into the Xcode project (SPM, no CocoaPods)
npx cap open ios       # opens Xcode
```

In Xcode: select the `App` target → Signing & Capabilities → choose your
team. Pick a simulator or a plugged-in iPhone and press Run. That's a
debuggable build of the real app.

Every time the web app or the data changes, re-run the three commands
above; the iOS shell itself almost never needs to change.

## What `npm run build:ios` actually does

- Moves `/api`, `/field`, `/admin` and the proxy aside (a static export
  cannot contain server code), strips the two `revalidate` exports, builds
  with `output: "export"`, then restores everything — the working tree is
  untouched afterwards, even if the build fails.
- Bakes `NEXT_PUBLIC_API_BASE=https://chinatown-cool-corners.vercel.app`
  into the bundle. The map and corners pages render with build-time data,
  then fetch fresh readings from `/api/public/readings` and
  `/api/public/corners` at runtime (those two endpoints are CORS-open,
  read-only, and serve exactly what the public web map already shows).
  Offline, the baked data stands — the shade model, destinations and the
  whole route planner are static files and work with no connection at all.
- Writes an entry `index.html` that lands people on `/en/map/`,
  `/zh-Hant/map/` or `/vi/map/` based on the phone's language.
- Excludes the service worker (the bundle *is* the offline cache) and
  fails if any server-only artefact leaks into `out/`.

To verify a bundle without Xcode: serve `out/` with any static file server
and run the browser suite against it —

```bash
cd out && python3 -m http.server 5222 &
mkdir -p out/api/public && echo "[]" > out/api/public/readings && echo "[]" > out/api/public/corners
PORT=5222 npm run smoke:routes
```

(the two stub files stand in for the live API, which a plain file server
does not have; the packaged app talks to the real one).

## App Store submission

1. In App Store Connect, create the app with the same bundle id.
2. In Xcode: Product → Archive → Distribute App → App Store Connect.
3. TestFlight the build on a real phone before submitting — check the
   planner end to end, airplane mode, and all three languages.
4. Fill in the privacy questionnaire: **Data Not Collected** — this app
   has no accounts, no analytics, no tracking, asks for no permissions
   (not even location: the planner is tap-based by design, §10), and the
   only network calls fetch public data. Few apps get to say this; say it
   prominently in the review notes too.
5. `ITSAppUsesNonExemptEncryption` is already `false` in Info.plist, so
   uploads skip the export-compliance question.

### Passing Guideline 4.2 (minimum functionality)

Apple rejects thin wrappers around websites. This app is not one, and the
review notes should spell that out:

> The app bundles its own data and computation: a modelled shade map for
> Boston's Chinatown (precomputed solar geometry), a walking-destinations
> layer, and a shaded-route planner that runs Dijkstra over a bundled
> sidewalk network entirely on-device. It works fully offline, including
> route planning. It is trilingual (English, Traditional Chinese,
> Vietnamese) for a neighbourhood where 59% of residents speak English
> less than "very well". No account, no tracking, no permissions.

If a reviewer still flags 4.2, the strongest follow-up is a short video of
the planner working in airplane mode.

### Suggested store metadata

- **Name:** Cool Corners — Chinatown Shade *(30-char limit: "Cool
  Corners: Chinatown Shade")*
- **Subtitle:** Shaded walking routes in Boston Chinatown
- **Keywords:** shade,heat,walking,routes,Boston,Chinatown,唐人街,bóng mát
- Localize the store listing for `zh-Hant` and `vi` — the catalogs in
  `src/messages/` already contain reviewed translations to draw from, and
  an English-only listing would undercut the project's whole point (§8).
- **Screenshots:** map with shade at 3pm; planner showing the three
  routes; destinations layer; one screenshot per language.

## Honesty notes (§0, §6 — they apply in the store too)

- The store description must not present the app as a cooling-centers
  directory or imply the City endorses it. Describe it as what it is: a
  shade model, field-verified, with the City's own cooling map one tap
  away.
- The modelled-shade disclaimer renders inside the app on every map view
  in all three languages; nothing about packaging changes that.
- The accessibility text fallback ("Field readings as a list") shows the
  readings baked at build time when offline; the map itself refreshes
  live. Rebuild and resubmit occasionally during a field campaign so the
  baked data doesn't lag months behind.

## Updating the app

Data (readings, corners) refreshes itself over the network. The bundled
shade model, network, destinations and code update only via a new build:

```bash
npm run extract:data && npm run build:shade        # if City data changed
npm run build:network && npm run build:exposure    # if the model changed
npm run extract:destinations
npm run build:ios && npx cap sync ios
```

then bump the version in Xcode (App target → General) and archive again.
