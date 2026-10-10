# The wind model

What it is, where every number comes from, how far to trust it, and how to
check it. Written so a planner, a grant reviewer or a later session can
answer "why does the map say Essex Street is calm?" without re-deriving
anything.

## In one paragraph

Wind is estimated in two independent parts. **Which way and how hard it
usually blows** comes from 16 years of real hourly observations at Boston
Logan Airport. **What each sidewalk does to that wind** comes from a
screening model that uses only building footprints and heights. The result
is a *relative* index — the share of open-ground wind that reaches a walker
on that sidewalk — not a measured speed, and the app never presents it as
one. It is good for "this street is windier than that one"; it is not good
for "it will be 14 mph on Essex Street."

## Part 1 — climatology (measured)

`npm run build:wind-climate` downloads hourly METARs for Logan (KBOS) from
the Iowa Environmental Mesonet, 2010–2025 (~140,000 observations), and for
each of the four representative dates the shade model already uses, and each
local hour, records the share of observations from each of 16 compass
sectors and the median speed per sector, using the +/-30 days around that
date. Winds under 3 knots or with no direction count as calm.

Sanity result, which `verify:wind` asserts: winter afternoons are mostly
westerly (Boston's northwesterlies) and summer afternoons mostly easterly
(the harbour sea breeze). A flipped bearing would swap them.

Limit: Logan sits on open water, so its 10 m winds are stronger than
anything between buildings. It sets direction and a reference speed only.

## Part 2 — the street model (screening)

`src/lib/wind-model.ts`, applied to every sidewalk edge for each of the 16
directions by `npm run build:wind`. Each edge is sampled at 25/50/75% of its
length and the results averaged. All inputs are building footprints and
heights; no wind data is involved.

1. **Open-ground reference.** Pedestrian height (1.5 m) over open, flat,
   low terrain is 0.67 of the 10 m wind (log law, z0 = 0.03 m). *Derived.*
2. **Shelter from upwind obstruction.** Five rays (-20 to +20 degrees about
   the wind direction, 250 m long) are cast against the footprints. Each
   ray that hits a building scores its elevation angle / 40 degrees
   (saturating at 1). The mean is the shelter S. The ratio interpolates
   between open ground (0.67) and dense urban fabric (0.30) by S. 0.30 is
   the middle of Reiter's (2010) terrain fits for urban areas (0.24 dense
   with tall buildings to 0.39 continuous blocks). *Method is my own
   synthesis; the endpoints are cited.* A useful property: a deep street is
   sheltered from a crosswind automatically (the facade is close and tall)
   while a wind along the street sees a long open path — no separate canyon
   formulas needed.
3. **Corner and downwash amplification** (Gandemer & Guyot, 1976, via the
   NBS translation, TN 710-9). Near the windward corners of a building at
   least 20 m tall *and* at least 1.5x its neighbours' mean height:
   1.2 at ~15 m, 1.4 at ~40 m, up to 2.2 at ~100 m, fading to 1 at 0.5 x the
   building's height (15–40 m). At the windward base of a 40 m+ building:
   1.0 at 30 m rising to 1.5 at 60 m. Corner and downwash take the larger,
   never the product.
4. **Enclosed-street channelling.** Wind within 30 degrees of the street
   axis, between buildings on both sides, street under 30 m wide, H/W of at
   least 0.5: up to x1.3 (the low end of Gandemer's 1.3–1.6 slot/venturi
   range). **This is the least well-supported part** — the survey found no
   published source for along-versus-cross-canyon ratios. It is applied as
   a maximum against amplification, not on top of it.
5. Capped at 2.2 (Reiter's worst double corner is ~2.7; Gandemer's tallest
   tower corner is 2.2).

Padded context: the shade extract is clipped to Chinatown, which is wrong
for wind (wind reaching the box edge has crossed the buildings just outside
it). `npm run extract:wind-context` fetches footprints in a 280 m margin
(1,588 footprints instead of 670; towers up to 209 m) into `scripts/data/`,
build-time only, never shipped. Without it boundary streets read as open
ground and come out artificially windy — the first run showed exactly that.

## How far to trust it

What the build and tests establish:

- **Physical orderings hold** (`verify:wind`, 18 checks on scenes with known
  answers): an open plaza gets the log-law ratio; a crosswind in a deep street
  is strongly sheltered; wind along the same street is stronger; rotating the
  wind toward the street axis never makes it calmer; the lee of a tall wall
  is sheltered and the windward side is not; a tall tower accelerates its
  windward corner and base; no tower influence 150 m away; mirrored scenes
  give mirrored answers; the ratio is capped and never zero.
- **The one input the source lacks barely matters.** 201 of the 1,588
  footprints have no recorded height; the model assumes 12 m. Re-running with
  6 m or 20 m leaves the street ranking essentially unchanged (Spearman rank
  correlation 0.977–0.994).
- **Boundary artifact removed.** Mean ratio on streets within ~40 m of the
  study-box edge differs from interior streets by only 0.01–0.03.
- **Plausible hotspots.** Under an easterly wind, Atlantic Ave at
  (42.3523, -71.0558), beside Dewey Square, is among the six windiest edges —
  Dewey Square being a spot the Boston Globe (2020) names as known to be
  windy — alongside open ground at the I-93 corridor; the narrow interior
  streets (Tyler, Oxford, Avery, Kingston, Harrison) come out calmest. The
  model was not told any of this, but it is a plausibility check, not a
  validation: Dewey Square is not the single windiest edge, and one named
  hotspot is thin evidence.

What nothing establishes:

- **No validation against measurements on these streets.** The survey found
  no published validation of an equation-only screening model against
  downtown wind-tunnel data; error is likely substantial, especially at
  tall-building corners. Treat the output as a guide.
- **Boston's own criteria are not used to label output.** The BPDA test is an
  effective gust (hourly mean + 1.5 x RMS) of 31 mph exceeded no more than 1%
  of the time, with mean-speed comfort bands of 12 / 15 / 19 / 27 mph at the
  99th percentile. The app shows *typical* conditions as three words (calm
  under 5 mph, breezy under 12, windy above) and does not claim BPDA
  compliance either way.
- Not modelled: trees, awnings, street furniture, terrain, thermal and rain
  effects, gust time-series, anything beyond 250 m upwind.

## What the router does with it

`planRoutes` takes an optional wind preference (calmer or breezier). The
cost of an edge adds a wind term next to the sun/shade term.

- **Calmer is convex** (`windDiscomfort`): zero at 2 mph and below, rising
  with the square up to "the day's windy end" (95th percentile of that day's
  edge speeds, never under 8 mph). Walkers do not mind 5 vs 6 mph; they mind
  the 13 mph corner. A first, linear version changed the chosen route on half
  of all trips yet cut the average wind on it by 0.05 mph — a feature that
  changes routes without delivering a calmer walk. Scaling to the day also
  matters: on a 25 mph day a fixed 12 mph cap saturated every street and the
  router avoided nothing.
- **Breezier is linear**, up to 10 mph.
- The app uses weight 2 for either: choosing it is an explicit request, so
  it outweighs the shade term.

Measured effect (400 random trips between real destinations, `calmer` on):

| Conditions | Top route changes | Mean wind | Worst stretch | Windy stretch avoided | Cost |
|---|---|---|---|---|---|
| Summer 2pm, usual easterly | 84% | 5.88 → 5.49 mph | 8.30 → 7.63 mph | 85 of 171 trips | 6.6 points of shade, 14 m |
| Winter noon, usual westerly | 82% | 6.42 → 6.04 mph | 8.76 → 8.36 mph | 42 of 155 trips | 5.3 points of sun, 17 m |
| Winter noon, strong (25 mph) | 80% | 11.62 → 10.97 mph | 15.87 → 15.17 mph | almost none | 5.1 points of sun, 11 m |

So: a real but modest benefit. Chinatown's sidewalks sit in a narrow wind band
(10th–90th percentile 3.8–7.6 mph on a usual afternoon), so on an average
trip there is little wind variation to exploit; the preference earns its keep
on trips that would otherwise cross an open or channelled stretch. On a
strong-wind day almost every street is windy and the network offers little
relief. The listing and the UI should not promise more than this.

## Validating it properly

The field tool now records wind with every reading, so the model can be
tested against the street. The tooling is built and tested; what is missing
is the readings.

**What the crew records** (all optional; the "Wind (optional)" group on the
capture form, collapsed by default so the 60-second flow is unchanged):

- the **average speed** over about 30 seconds, held at chest height facing
  into the wind, and the **highest gust** in that time;
- the **compass point the wind comes FROM**, eight points;
- the **anemometer's unit**. Handheld anemometers show mph, m/s, km/h or
  knots, and a m/s value typed as mph would be wrong by a factor of 2.2 with
  nothing downstream able to tell. The form converts once and always stores
  mph, shows "Saved as 11.2 mph average" under the boxes so a wrong unit is
  visible, and remembers the unit between sites.

Guard rails, all in `src/lib/validation.ts` and the form: a speed the server
would reject (over 120 mph average or 150 gust) blocks the save instead of
stranding the reading in the upload queue; text in a wind box is called out
rather than silently dropped; over 40 mph prompts a unit check; a gust below
the average is saved but flagged (`gust_below_mean`), like every anomaly in
this dataset. "Not measured" is stored as null, never 0: calm is a
measurement and absence is not.

**Running the check**, once the crew has taken readings:

```bash
# admin console -> Export CSV, then:
npm run compare:wind -- path/to/readings.csv
```

It downloads the matching hourly Logan observations, turns each crew reading
into a ratio against Logan at that hour, and compares it with the model's
ratio for the nearest sidewalk, using Logan's direction exactly as the app
does. It reports rank agreement (Spearman), the median bias and the mean
absolute error, and states a verdict only with at least 15 usable readings.
Agreement of 0.5 or more is "agrees", 0.2 to 0.5 "weak", below 0.2
"disagrees". If it disagrees, the app's wind figures should not be presented
as reliable and `/about` should say so.

Read the result with its limits in mind:

- Each crew reading is a 30-60 second average against an hourly airport
  observation, so single points are noisy. Trust the pattern over many.
- Readings taken at an intersection are ambiguous between the sidewalks that
  meet there, and the nearest-edge match can land on either. Ask the crew to
  stand mid-block for wind readings where they can.
- Readings more than 25 m from any sidewalk, taken in a calm Logan hour, or
  with no Logan observation within 45 minutes are skipped and counted, not
  quietly dropped.
- It tests the model's *ranking* of streets. It says nothing about whether
  the calm/breezy/windy words are the right size.

The tool itself is tested end to end against synthetic readings with a known
answer (a crew that measured exactly what the model says gives rank agreement
1; the reverse gives -1; a uniformly twice-as-windy crew still "agrees" with a
bias of 2; too few readings never produce a verdict), and a CSV produced by
the real exporter, including quoted cells, was round-tripped through it
against live Logan data.

**Database:** adding the fields is migration `drizzle/0001_*.sql` (three
nullable columns and range checks, purely additive). Run `npm run db:migrate`
before the crew uses a version of the field tool that sends wind; until the
columns exist the API cannot save a reading that includes them, and it stays
in the phone's queue (not lost) until it can.

## Regenerating

```bash
npm run build:wind-climate    # Logan observations -> public/data/wind/climate.json
npm run extract:wind-context  # padded footprints -> scripts/data/ (build input)
npm run build:wind            # model over every edge -> public/data/wind/ratios.json
npm run verify:wind           # model orderings + shipped-data checks
```

`build:wind` needs `build:network` first, and `ratios.json` records the edge
count it was built for: if the network is rebuilt without rebuilding wind,
the app detects the mismatch and shows no wind figures rather than putting
wind on the wrong streets.

## Scope note

SPEC section 2 puts "real-time temperature feeds or weather forecasting" out
of scope. This uses historical *climatology*, precomputed and static, not a
forecast, and no weather service is called at request time. If live wind is
ever wanted, the National Weather Service API is free and keyless, and a
fixed Chinatown coordinate would not leak anything about the user — but it
would break offline use and is a separate decision.

## Sources

- Gandemer, J. & Guyot, A. (1976), *Integration du phenomene vent dans la
  conception du milieu bati*; English translation NBS Technical Note 710-9
  (1978).
- Reiter, S. (2010), *Assessing wind comfort in urban planning*,
  Environment and Planning B.
- Janssen, W.D., Blocken, B. & van Hooff, T. (2013), *Pedestrian wind comfort
  around buildings: comparison of wind comfort criteria based on whole-flow
  field data*, Building and Environment.
- RWDI (2018), pedestrian wind assessment for 150 Kneeland Street (BPDA
  Article 80 filing) — source for the BPDA criteria and Logan wind roses.
- Boston Logan hourly observations: Iowa Environmental Mesonet.
