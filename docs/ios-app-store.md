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
- **A Mac with Xcode 26 or later is required** to build, test and upload.
  Since 28 April 2026 App Store Connect rejects uploads built with an older
  SDK before review even starts. Xcode 26.0 needs macOS Sequoia 15.6+;
  Xcode 26.4 and later need macOS Tahoe 26.2+ — check the Mac's macOS
  version before downloading anything. There is no way around needing a
  Mac; everything below assumes one.
- App releases go through App Review (typically 1–2 days). The website
  stays the place where fixes land immediately.

## One-time setup (Mac)

1. Install Xcode from the App Store, then `xcode-select --install`.
2. Enroll in the Apple Developer Program at developer.apple.com ($99/yr).
   Choose the account type deliberately, because it decides whose name the
   App Store shows as the seller:
   - **Individual** — no legal entity or D-U-N-S number needed; usually
     approved in days; the seller is a person's name.
   - **Organization** — needs a legal entity and a D-U-N-S number (free
     from Dun & Bradstreet, up to ~30 days if the organization has none);
     the seller is the organization. Registered nonprofits can request a
     fee waiver during enrollment; reportedly it only applies to
     organization accounts distributing free apps with no in-app
     purchases (this app qualifies on the second count) — confirm on
     Apple's fee-waiver page before counting on it.
   You can start building and running in the Simulator with only a free
   Apple ID while enrollment is pending; TestFlight and submission need
   the paid program.
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

### Store metadata

Ready-to-paste, research-grounded listing copy for all three locales —
name, subtitle, keywords, promotional text, full descriptions, and the
screenshot plan — lives in **docs/store-listing.md**. The short version of
the strategy it encodes: anchor on the uncontested "shade / shaded walk /
cool walk" keyword family and stay off "sun position"/"sun tracker" (six
4.7★+ incumbents); put "free — no ads, no accounts, nothing collected" in
the first lines; localize the listing itself in Traditional Chinese and
Vietnamese (no competitor does); and treat heat-wave press, not search, as
the discovery channel. The zh-Hant/vi copy must pass community-translator
review before it goes into App Store Connect (§8), and no edit may ever
present the app as a cooling-centers directory (§0).

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

## Feature roadmap borrowed from the field

A study of Korea's Geuneullo — the one shade-routing app with proven mass
adoption (notes: research_notes/Shade and cooling app landscape/
geuneullo-feature-study.md; the folder is gitignored, regenerate via the
session that produced it or keep a copy) — sorted its features into three
buckets for this app:

**Adopted already:** departure time defaults to "now" with a one-tap Now
button (their core mechanic: you plan the walk you are about to take);
per-segment sun marking on the chosen route (amber ticks over the sunny
stretches); %-shade per route; time slider re-ranking routes; winter sun
mode (their users walk the sunny side in winter too — our precomputed
winter-solstice exposure made the flip nearly free).

**Added after the study, on the user's own request:** wind. A layer of
estimated wind on every sidewalk and a calmer/breezier route preference,
built from real Logan observations plus a building-geometry screening
model (docs/wind-model.md). Its measured benefit is real but modest, and
it is unvalidated against on-street measurements — keep the store copy to
"estimate", as the listing does.

**Worth doing next, in order:**
1. Live "remaining shade ahead" while walking a chosen route (they show
   remaining distance/time/shade during the walk) — needs only geolocation
   at walk time, opt-in, never tracked (§10).
2. Saved places — the three places an elder actually walks to, stored
   locally on the phone, no account (they ship favorites with no sign-up).
3. Crosswalk/stairs/slope flags on route cards — our network already
   distinguishes crosswalk types; slope needs City elevation data.
4. Route-to-cooling-sites: City/MAPC cooling locations as destinations
   with a "call 311 to confirm hours" affordance — complement by
   reference, never re-list (§0). Their heat-shelter layer validates the
   demand; the City map stays the source of truth.

**Noted and deliberately not doing:** transit seat-side suggestions (no
usable Boston transit heading data, and off-mission), server-side shade
computation (theirs crashed at 20k users/day; our static files cannot),
night-safety routing (different mission), ads (their listing's one sour
note — declared ad tracking on a "free, no monetization" app; ours
collects nothing and says so).

One process lesson worth copying outright: the developer replies to App
Store reviews and ships small requested fixes within days — their night
mode came from a middle schooler's review. With the Claude Code release
loop, this project can match that cadence.

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
