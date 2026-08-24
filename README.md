# Chinatown Cool Corners

A shade map for Boston's Chinatown, and the offline-first field tool used to
gather the temperature readings behind it.

Two applications, one database:

- **Field Tool** (`/field`, crew-only) — a phone-first PWA for recording
  paired sun/shade surface temperatures on the sidewalk. Works in airplane
  mode. This is the part with a deadline.
- **Shade Layer** (`/`, public, trilingual) — where shade actually exists,
  block by block, by hour, computed from open City data and shown alongside
  the field readings that check it.

## What this is not

**Not a cooling-centre directory.** The City of Boston's Office of Emergency
Management already runs one. Every layer on it is an indoor or water
facility; there is no shade data on it anywhere, and Boston has published no
shade map. That gap is the whole project. Where this app needs to point
someone at an indoor cooling resource it deep-links out to the City's map —
see `src/components/city-cooling-link.tsx`.

## Getting set up

```bash
npm install
cp .env.example .env.local        # fill in the values
npm run db:migrate                # create the tables
npm run seed:sites                # load the sites fixture
npm run seed:corners              # load the cooling corners fixture
npm run dev
```

Everything runs on free tiers: Vercel Hobby, Neon free, Vercel Blob free. No
service here requires a credit card, and the map uses MapLibre with a keyless
basemap — never Mapbox or Google, both of which require billing.

## Regenerating the shade model

The shade layer is precomputed and committed. Rebuild it when the City
publishes new data, or when you change the model:

```bash
npm run extract:data          # pull trees + buildings from data.boston.gov, clip to Chinatown
npm run build:shade           # precompute shadow geometry (~5 minutes)
npm run build:network         # pull sidewalk centrelines, build the walking graph
npm run build:exposure        # per-edge sun exposure per half-hour (needs the two above)
npm run extract:destinations  # pharmacies, library, hospitals, housing, restaurants, parks
```

`extract:data` writes `public/data/{trees,buildings}.geojson`.
`build:shade` writes one file per half-hour per representative date under
`public/data/shade/`, plus an `index.json` the app reads for its limitation
figures. `build:network` writes the routable pedestrian graph
(`network.json`), built from the City's sidewalk-centreline layer — real
sidewalks and crosswalks, not street centrelines, because the two sides of
one street can differ by tens of degrees. `build:exposure` intersects every
walkway edge with every shade slot so the route planner is a lookup, not a
computation. The City APIs are never called at request time.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build — **note `--webpack`**, see below |
| `npm run db:generate` / `db:migrate` | Drizzle migrations |
| `npm run seed:sites` / `seed:corners` | Load fixtures (idempotent) |
| `npm run extract:data` | Refresh the City data extracts |
| `npm run build:shade` | Recompute the shade geometry |
| `npm run build:network` | Rebuild the walking graph from City sidewalk data |
| `npm run build:exposure` | Recompute per-edge sun exposure per time slot |
| `npm run extract:destinations` | Refresh the walking-destinations layer |
| `npm run verify:shade` | Assert the solar geometry against physics |
| `npm run verify:routing` | Assert the route planner on a synthetic grid |
| `npm run verify:network` | Assert the real graph: connected, covers the bbox, sane distances |
| `npm run check:i18n` | Catalogs in sync + translation review status |
| `npm run smoke:map` | Browser test: are shadows actually painted? |
| `npm run smoke:offline` | Browser test: airplane-mode field capture |
| `npm run smoke:routes` | Browser test: destinations + shaded route planner |
| `npm run lint` | ESLint |

The browser smoke tests need a built app running:

```bash
npm run build && npx next start -p 3555
npm run smoke:map
PORT=3555 npm run smoke:offline
PORT=3555 npm run smoke:routes
```

## Things that will bite you

**The build must run under webpack.** `next-pwa` works by hooking Next's
webpack config, and Next 16 builds with Turbopack by default. Under Turbopack
the hook never runs, the build *succeeds*, and no service worker is emitted —
so the Field Tool silently loses all offline support while every check stays
green. `npm run build` passes `--webpack`, and `scripts/check-service-worker.ts`
fails the build if `sw.js` ever goes missing. Don't "simplify" either away.

**MapLibre's worker is served as a static asset.** Bundled through Next, its
internal worker URL resolves to the page itself; the worker then parses HTML,
dies silently, and every GeoJSON source stays empty — a basemap with no
shadows on it. `scripts/copy-maplibre-worker.ts` copies the worker and its
shared chunk into `public/` at prebuild, and the map calls `setWorkerUrl`.

**Both of those failures are invisible without the smoke tests.** They
produce no console error, no failed request, and a green build. Run them
before shipping anything that touches the map or the service worker.

## What is placeholder data

Three fixtures ship with clearly-marked placeholders, because the real
versions require fieldwork this repository cannot fabricate:

- `src/fixtures/sites.json` — 8 example sites plus 2 control points, not the
  real 60. See the README in that directory.
- `src/fixtures/cooling-corners.json` — the two installations, which do not
  exist yet. `/corners` says so plainly until they do.
- `src/lib/blocks.ts` — print-sheet block extents, derived from the bounding
  box rather than surveyed.

The tree and building data are real: 433 trees and 670 building footprints
pulled from City of Boston open data and clipped to the Chinatown bounding
box in the spec.

## Before public launch

`npm run check:i18n` reports both non-English catalogs as
`UNREVIEWED_MACHINE_DRAFT`. They are a first pass and **must** be reviewed by
a community translator before launch — the grant budgets six hours for
exactly this. Flip `reviewStatus` to `COMMUNITY_REVIEWED` in
`src/messages/*.json` once that has happened. An English-only launch, or a
launch on unreviewed machine translation, misses the people this is for: 59%
of Chinatown residents speak English less than "very well".

## Honesty rules baked into the code

These are not decoration; they're why the project is fundable and why anyone
should trust the map:

- Modelled shade is never presented as measured fact. The disclaimer renders
  in all three languages at once, above the map, on every page that shows it.
- Field readings render as solid outlined dots that cannot be mistaken for
  the flat translucent modelled fills. Where a reading disagrees with the
  model, both are shown.
- Tree shadows draw lighter than building shadows, because opaque-circle
  crowns are the less certain of the two.
- Buildings with no usable height are skipped, not guessed tall. The count
  (currently 79 of 670) is read from the shade index and stated on `/about`,
  so it cannot drift from what the model actually did.
- Crown size and height are estimated from trunk diameter — the City's tree
  layer has no crown or height field — and `/about` says so, with the
  constants.
- Negative and implausible temperature deltas are saved and flagged, never
  silently rejected. Anomalies are data.
- The route planner runs entirely in the browser over precomputed data. No
  geocoder or routing service is called — where somebody walks from and to
  is user data, and §10 forbids sending it off-origin. Place search matches
  against the locally-downloaded destinations list only.
- The destinations layer is places to walk TO, so the planner can show which
  way there is shaded. It records nothing about air conditioning, refuge
  status or opening hours — that is the City's cooling map, which the app
  links out to (§0). Keep it that way.
- Where the source data has a real gap, the UI says so: BHA has no
  development inside Chinatown itself, and the layer says that rather than
  letting a near-empty layer imply the neighbourhood has no public housing.

## Deviations from the spec

Documented at the call sites, summarised here:

- **`suncalc` units.** §6 describes the v1.x API (radians, azimuth from
  south). suncalc 2.x returns degrees, azimuth clockwise from north. Same
  physics. `npm run verify:shade` asserts the result against known solar
  geometry rather than against the implementation.
- **Tree crown data.** §6 says to "use the diameter field where present".
  The BPRD Trees layer has no crown or height field at all — only trunk dbh,
  as a string. See `src/lib/tree-allometry.ts`.
- **Boston 3D Buildings.** §5 lists it as a fallback height source. It is a
  SceneServer with no queryable feature layer. The roof-breaks layer covers
  every footprint anyway; its heights are in feet and are converted.
- **`middleware.ts` is `proxy.ts`.** Next 16 renamed the convention.
- **Shade output is per-half-hour files.** §6 says to ship precomputed
  GeoJSON; a whole-day bundle came to 6.7 MB, so each slot is its own ~54 KB
  file and the map fetches only the one it shows.

## Layout

```
src/
  app/[locale]/        public site (en / zh-Hant / vi)
  app/field/           crew field tool (English; internal instrument)
  app/admin/           lead-only dashboard and exports
  app/api/             readings, sites, coverage, photos, auth, exports
  components/          shared UI
  db/                  Drizzle schema and client
  i18n/                next-intl routing and request config
  lib/                 shade model, allometry, offline queue, sync, exports
  messages/            translation catalogs
  fixtures/            seed data (placeholders — see above)
scripts/               extract, precompute, seed, verify, smoke tests
public/data/           committed City extracts and precomputed shade
```
