/**
 * Checks the urban-geometry toolkit against shapes whose answers are known
 * by construction: a ray cast that is subtly wrong would not look wrong in
 * a wind map — it would just quietly put the windy streets in the wrong
 * places.
 *
 * Run with: npm run verify:wind
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SECTOR_COUNT, SECTOR_NAMES, sectorOf, typicalWind, windFeel } from "../src/lib/wind";
import type { WindClimate } from "../src/lib/wind";
import { WIND_UNITS, roundMph, toMph } from "../src/lib/wind-units";
import { classifyReading, readingInputSchema } from "../src/lib/validation";
import {
  MIN_READINGS_FOR_VERDICT,
  compareWindToCrew,
  nearestEdge,
  spearman,
  type FieldWindReading,
  type LoganObservation,
} from "../src/lib/wind-validation";
import type { WalkNetwork } from "../src/lib/network";
import {
  RATIO_CAP,
  RATIO_DENSE,
  RATIO_OPEN,
  windAtPoint,
  type WindContext,
} from "../src/lib/wind-model";
import {
  ObstacleIndex,
  angleBetween,
  bearingBetween,
  bearingVector,
  makeObstacle,
  makeProjection,
  type Metric,
} from "../src/lib/urban-geometry";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** Axis-aligned box, [x0,y0]-[x1,y1] metres. */
function box(id: string, x0: number, y0: number, x1: number, y1: number, h: number) {
  const ring: Metric[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return makeObstacle(id, ring, h, false);
}

console.log("\nBearings and vectors");
{
  const [e, n] = bearingVector(90);
  check("bearing 90 points east", near(e, 1) && near(n, 0));
  const [e2, n2] = bearingVector(0);
  check("bearing 0 points north", near(e2, 0) && near(n2, 1));
  check("bearing from origin to east point is 90", near(bearingBetween([0, 0], [10, 0]), 90));
  check("bearing from origin to south point is 180", near(bearingBetween([0, 0], [0, -10]), 180));
  check("angle wraps across north (350 vs 10 = 20)", near(angleBetween(350, 10), 20));
  check("angle is symmetric", near(angleBetween(30, 200), angleBetween(200, 30)));
}

console.log("\nProjection");
{
  const p = makeProjection(42.3515, -71.0605);
  const [x, y] = p.toMetric(-71.0605, 42.3515);
  check("origin projects to (0, 0)", near(x, 0) && near(y, 0));
  const [, north] = p.toMetric(-71.0605, 42.3515 + 0.001);
  check("0.001 deg of latitude is ~111 m", near(north, 111.13, 0.5), `(got ${north.toFixed(2)})`);
  const [east] = p.toMetric(-71.0605 + 0.001, 42.3515);
  check("0.001 deg of longitude is ~82 m at 42 N", near(east, 82.3, 0.7), `(got ${east.toFixed(2)})`);
  const back = p.toLngLat(p.toMetric(-71.0612, 42.3498));
  check("projection round-trips", near(back[0], -71.0612, 1e-9) && near(back[1], 42.3498, 1e-9));
}

console.log("\nRay casting");
{
  const wall = box("wall", 20, -10, 30, 10, 25);
  const index = new ObstacleIndex([wall]);

  const east = index.castRay([0, 0], 90, 100);
  check("a ray east hits the wall's near face at 20 m", !!east && near(east.distance, 20), `(got ${east?.distance})`);
  check("the hit reports the wall's height", east?.obstacle.height === 25);

  check("a ray west finds nothing", index.castRay([0, 0], 270, 100) === null);
  check("a ray north passes beside the wall", index.castRay([0, 0], 0, 100) === null);
  check("range limit is respected", index.castRay([0, 0], 90, 15) === null);

  const diagonal = index.castRay([0, -30], 45, 100);
  check(
    "a diagonal ray from the south-west hits the south face",
    !!diagonal && near(diagonal.distance, 28.28, 0.05),
    `(got ${diagonal?.distance})`,
  );

  const near1 = box("near", 10, -5, 15, 5, 10);
  const far1 = box("far", 40, -5, 50, 5, 40);
  const both = new ObstacleIndex([far1, wall, near1]);
  const first = both.castRay([0, 0], 90, 100);
  check(
    "with several buildings in line the NEAREST is reported",
    first?.obstacle.id === "near" && near(first.distance, 10),
    `(got ${first?.obstacle.id} at ${first?.distance})`,
  );

  // Starting inside a footprint (misaligned source data) must not read as
  // "blocked at 0 m" by the building we are standing in.
  const inside = index.castRay([25, 0], 90, 100);
  check("a ray starting inside a building ignores that building", inside === null, `(got ${inside?.distance})`);
}

console.log("\nStreet width from rays");
{
  // A 12 m wide street running east-west between two long buildings.
  const south = box("south", -100, -30, 100, -6, 18);
  const north = box("north", -100, 6, 100, 30, 24);
  const index = new ObstacleIndex([south, north]);
  const left = index.castRay([0, 0], 0, 60);
  const right = index.castRay([0, 0], 180, 60);
  check("north facade is 6 m away", !!left && near(left.distance, 6));
  check("south facade is 6 m away", !!right && near(right.distance, 6));
  const width = (left?.distance ?? 0) + (right?.distance ?? 0);
  check("street width comes out as 12 m", near(width, 12));
  const meanH = ((left?.obstacle.height ?? 0) + (right?.obstacle.height ?? 0)) / 2;
  check("mean facade height is 21 m, so H/W is 1.75", near(meanH / width, 1.75));
}

console.log("\nNeighbourhood queries");
{
  const a = box("a", 0, 0, 10, 10, 10);
  const b = box("b", 200, 200, 210, 210, 10);
  const index = new ObstacleIndex([a, b]);
  check("within() finds the close building only", index.within([0, 0], 50).length === 1);
  check("within() with a big radius finds both", index.within([100, 100], 200).length === 2);
}

console.log("\nWind model: physical orderings that must hold");
{
  const ctxOf = (obstacles: ReturnType<typeof box>[]): WindContext => ({
    index: new ObstacleIndex(obstacles),
  });
  const WEST = 270; // wind FROM the west, blowing east
  const NORTH = 0;
  const STREET_EW = 90; // a street running east-west

  // 1. Open ground.
  const open = windAtPoint(ctxOf([]), [0, 0], STREET_EW, WEST);
  check(
    "open ground gets the log-law ratio",
    near(open.ratio, RATIO_OPEN, 0.001),
    `(got ${open.ratio.toFixed(3)}, expected ${RATIO_OPEN})`,
  );

  // 2. A 12 m wide east-west street, 24 m buildings both sides.
  const canyon = ctxOf([
    box("s", -200, -36, 200, -6, 24),
    box("n", -200, 6, 200, 36, 24),
  ]);
  const along = windAtPoint(canyon, [0, 0], STREET_EW, WEST); // wind blows down the street
  const cross = windAtPoint(canyon, [0, 0], STREET_EW, NORTH); // wind blows across it
  check(
    "a crosswind in a deep street is strongly sheltered",
    cross.ratio < RATIO_DENSE + 0.05,
    `(got ${cross.ratio.toFixed(3)})`,
  );
  check(
    "wind along the same street is much stronger than across it",
    along.ratio > cross.ratio * 1.5,
    `(along ${along.ratio.toFixed(3)} vs cross ${cross.ratio.toFixed(3)})`,
  );
  check(
    "an along-street wind in an enclosed canyon is channelled (factor > 1)",
    along.channel > 1.05,
    `(channel ${along.channel.toFixed(3)})`,
  );
  check("a crosswind is not channelled", cross.channel === 1);

  // Rotate the wind from across the street (from the north) to along it
  // (from the east): the street may get windier, never calmer.
  const sweepRatios = [0, 15, 30, 45, 60, 75, 90].map(
    (fromBearing) => windAtPoint(canyon, [0, 0], STREET_EW, fromBearing).ratio,
  );
  check(
    "rotating the wind from across a street to along it never makes it calmer",
    sweepRatios.every((r, i) => i === 0 || r >= sweepRatios[i - 1] - 0.01),
    `(${sweepRatios.map((r) => r.toFixed(2)).join(" → ")})`,
  );

  // 3. Lee of a long 30 m wall: wind from the west, point 15 m east of it.
  const wall = ctxOf([box("wall", -10, -200, 0, 200, 30)]);
  const lee = windAtPoint(wall, [15, 0], STREET_EW, WEST);
  const windward = windAtPoint(wall, [-15, 0], STREET_EW, WEST);
  check("the lee of a long tall wall is sheltered", lee.ratio < 0.45, `(got ${lee.ratio.toFixed(3)})`);
  check(
    "the windward side of the same wall is not sheltered",
    windward.ratio > lee.ratio + 0.15,
    `(windward ${windward.ratio.toFixed(3)} vs lee ${lee.ratio.toFixed(3)})`,
  );
  const farLee = windAtPoint(wall, [400, 0], STREET_EW, WEST);
  check("shelter does not reach 400 m downwind", near(farLee.ratio, RATIO_OPEN, 0.001));

  // 4. A tall tower among low-rise: corners and downwash.
  const lowrise = [
    box("l1", -80, -60, -30, -40, 12),
    box("l2", -80, 40, -30, 60, 12),
    box("l3", 30, -60, 80, -40, 12),
    box("l4", 30, 40, 80, 60, 12),
  ];
  const tower = box("tower", -10, -10, 10, 10, 90);
  const withTower = ctxOf([...lowrise, tower]);
  const noTower = ctxOf([...lowrise, box("tower", -10, -10, 10, 10, 12)]);

  const cornerPoint: [number, number] = [-12, 11]; // beside the NW (windward) corner
  const cornerWith = windAtPoint(withTower, cornerPoint, NORTH, WEST);
  const cornerWithout = windAtPoint(noTower, cornerPoint, NORTH, WEST);
  check(
    "a tall tower accelerates the wind at its windward corner",
    cornerWith.amplification > 1.5,
    `(amplification ${cornerWith.amplification.toFixed(2)})`,
  );
  check(
    "the same spot with a low building there has no amplification",
    cornerWithout.amplification === 1,
    `(got ${cornerWithout.amplification})`,
  );
  check(
    "the tower makes that corner clearly windier than without it",
    cornerWith.ratio > cornerWithout.ratio * 1.4,
    `(${cornerWith.ratio.toFixed(3)} vs ${cornerWithout.ratio.toFixed(3)})`,
  );

  const faceBase = windAtPoint(withTower, [-14, 0], NORTH, WEST);
  check(
    "downwash raises the wind at the windward base of a 90 m tower",
    faceBase.amplification > 1.4,
    `(amplification ${faceBase.amplification.toFixed(2)})`,
  );

  const leeOfTower = windAtPoint(withTower, [25, 0], NORTH, WEST);
  check(
    "the lee side of the tower is calmer than its windward corner",
    leeOfTower.ratio < cornerWith.ratio,
    `(lee ${leeOfTower.ratio.toFixed(3)} vs corner ${cornerWith.ratio.toFixed(3)})`,
  );

  const farFromTower = windAtPoint(withTower, [0, 150], NORTH, WEST);
  check("no tower influence 150 m away", farFromTower.amplification === 1);

  // 5. Mirror symmetry: the model must not prefer a compass direction.
  const west = windAtPoint(withTower, [-12, 11], NORTH, 270);
  const east = windAtPoint(withTower, [12, 11], NORTH, 90);
  check(
    "a mirrored scene gives the mirrored answer",
    near(west.ratio, east.ratio, 0.02),
    `(${west.ratio.toFixed(3)} vs ${east.ratio.toFixed(3)})`,
  );

  // 6. Hard cap.
  const skyscrapers = ctxOf([...lowrise, box("huge", -10, -10, 10, 10, 400)]);
  const capped = windAtPoint(skyscrapers, cornerPoint, NORTH, WEST);
  check(
    "the ratio never exceeds the cap",
    capped.ratio <= RATIO_CAP + 1e-9,
    `(got ${capped.ratio.toFixed(3)})`,
  );
  check(
    "the ratio never goes to zero",
    windAtPoint(canyon, [0, 0], STREET_EW, NORTH).ratio > 0.1,
  );
}

console.log("\nWind vocabulary");
{
  check("compass sectors: 0 deg is N, 90 is E, 270 is W", sectorOf(0) === 0 && sectorOf(90) === 4 && sectorOf(270) === 12);
  check("sector names line up with bearings", SECTOR_NAMES[sectorOf(315)] === "NW" && SECTOR_NAMES[sectorOf(180)] === "S");
  check("bearings wrap (359 deg is N, -10 deg is N)", sectorOf(359) === 0 && sectorOf(-10) === 0);
  check("a bearing just past a sector edge goes to the next sector", sectorOf(11.3) === 1 && sectorOf(11.2) === 0);
  check("feel words: 3 mph calm, 8 breezy, 14 windy", windFeel(3) === "calm" && windFeel(8) === "breezy" && windFeel(14) === "windy");
}

console.log("\nShipped wind data");
{
  const dataDir = join(process.cwd(), "public", "data");
  const have = existsSync(join(dataDir, "wind", "ratios.json")) && existsSync(join(dataDir, "wind", "climate.json"));
  check("wind data files exist (run npm run build:wind and build:wind-climate)", have);
  if (have) {
    const network = JSON.parse(readFileSync(join(dataDir, "network.json"), "utf8")) as { edges: unknown[] };
    const model = JSON.parse(readFileSync(join(dataDir, "wind", "ratios.json"), "utf8")) as {
      sectorCount: number;
      edgeCount: number;
      ratios: number[][];
    };
    const climate = JSON.parse(readFileSync(join(dataDir, "wind", "climate.json"), "utf8")) as WindClimate;

    check("ratios are for exactly this network's edges", model.edgeCount === network.edges.length, `(${model.edgeCount} vs ${network.edges.length})`);
    check("one row of ratios per compass sector", model.ratios.length === SECTOR_COUNT && model.sectorCount === SECTOR_COUNT);
    check("every row covers every edge", model.ratios.every((row) => row.length === model.edgeCount));
    const flat = model.ratios.flat();
    check("every ratio is a number in (0, cap]", flat.every((v) => Number.isFinite(v) && v > 0 && v <= RATIO_CAP * 100 + 1));
    const median = [...flat].sort((a, b) => a - b)[flat.length >> 1];
    check("typical street ratio is in a believable band (25-60%)", median >= 25 && median <= 60, `(median ${median}%)`);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const spread = Math.max(...model.ratios.map(mean)) - Math.min(...model.ratios.map(mean));
    check("different wind directions give different answers", spread > 0.4, `(spread of direction means ${spread.toFixed(2)}%)`);
    check("streets differ from one another within a wind", Math.max(...model.ratios[12]) - Math.min(...model.ratios[12]) > 30);

    const keys = Object.keys(climate.dates);
    check("climate covers all four representative dates", keys.length === 4, `(${keys.join(", ")})`);
    for (const key of keys) {
      const hours = climate.dates[key].hours;
      check(`${key}: 24 hours, 16 sectors each`, hours.length === 24 && hours.every((h) => h.frequency.length === 16 && h.speedMph.length === 16));
      check(
        `${key}: direction frequencies sum to 1 every hour`,
        hours.every((h) => Math.abs(h.frequency.reduce((a, b) => a + b, 0) - 1) < 0.02),
      );
      check(`${key}: every hour has real observations behind it`, hours.every((h) => h.n > 500), `(min n ${Math.min(...hours.map((h) => h.n))})`);
    }

    // Boston's well-known climate, as a check that the observations were
    // read the right way round (a flipped bearing would swap these).
    const winterNoon = typicalWind(climate, "winter-solstice", 13);
    const summerAfternoon = typicalWind(climate, "summer-solstice", 14);
    check(
      "winter afternoons are mostly westerly or northwesterly",
      !!winterNoon && [11, 12, 13, 14].includes(winterNoon.sector),
      `(sector ${winterNoon?.sector} = ${SECTOR_NAMES[winterNoon?.sector ?? 0]})`,
    );
    check(
      "summer afternoons favour the harbour sea breeze (east to south)",
      !!summerAfternoon && [3, 4, 5, 6, 7, 8].includes(summerAfternoon.sector),
      `(sector ${summerAfternoon?.sector} = ${SECTOR_NAMES[summerAfternoon?.sector ?? 0]})`,
    );
    check(
      "open-airport speeds are plausible (6-20 mph typical)",
      !!winterNoon && winterNoon.speedMph > 6 && winterNoon.speedMph < 20,
      `(${winterNoon?.speedMph} mph)`,
    );
  }
}

console.log("\nField wind readings: units");
{
  check("mph is the identity", toMph(10, "mph") === 10);
  check("10 m/s is 22.4 mph", near(toMph(10, "ms"), 22.37, 0.01));
  check("10 km/h is 6.2 mph", near(toMph(10, "kmh"), 6.21, 0.01));
  check("10 knots is 11.5 mph", near(toMph(10, "knots"), 11.51, 0.01));
  check("all four units are offered", WIND_UNITS.length === 4);
  check("stored values round to one decimal", roundMph(7.8473) === 7.8 && roundMph(7.85) === 7.9);
  check("zero stays zero (a calm reading is data)", toMph(0, "ms") === 0);
}

console.log("\nField wind readings: validation and flags");
{
  const base = {
    id: "3f6c1d2e-8a4b-4c1e-9d7a-2b5f0c9e1a11",
    siteId: 1,
    observer: "Mei",
    recordedAt: "2026-10-10T18:30:00.000Z",
    surfaceType: "asphalt",
    sunTempF: 120,
    shadeTempF: 98,
    shadeSource: "tree",
  } as const;

  check("a reading with no wind is still valid (wind is optional)", readingInputSchema.safeParse(base).success);
  check(
    "a reading with full wind data is valid",
    readingInputSchema.safeParse({ ...base, windMph: 7.5, windGustMph: 12, windFrom: "W" }).success,
  );
  check("explicit nulls are accepted (older clients, cleared fields)", readingInputSchema.safeParse({ ...base, windMph: null, windGustMph: null, windFrom: null }).success);
  check("zero wind is accepted (calm is a measurement)", readingInputSchema.safeParse({ ...base, windMph: 0 }).success);
  check("negative wind is rejected", !readingInputSchema.safeParse({ ...base, windMph: -1 }).success);
  check("a 121 mph average is rejected", !readingInputSchema.safeParse({ ...base, windMph: 121 }).success);
  check("a 151 mph gust is rejected", !readingInputSchema.safeParse({ ...base, windGustMph: 151 }).success);
  check("an invalid compass point is rejected", !readingInputSchema.safeParse({ ...base, windFrom: "NNE" }).success);
  check("wind as text is rejected", !readingInputSchema.safeParse({ ...base, windMph: "windy" }).success);

  check("no wind: no flag", !classifyReading({ sunTempF: 120, shadeTempF: 98 }).flagged);
  check("gust above mean: no flag", !classifyReading({ sunTempF: 120, shadeTempF: 98, windMph: 7, windGustMph: 12 }).flagged);
  check("gust equal to mean: no flag", !classifyReading({ sunTempF: 120, shadeTempF: 98, windMph: 7, windGustMph: 7 }).flagged);
  const impossible = classifyReading({ sunTempF: 120, shadeTempF: 98, windMph: 12, windGustMph: 7 });
  check("gust below mean is flagged, with its own reason", impossible.flagged && impossible.flagReason === "gust_below_mean");
  const both = classifyReading({ sunTempF: 90, shadeTempF: 98, windMph: 12, windGustMph: 7 });
  check("a temperature anomaly takes precedence over a wind one", both.flagReason === "negative_delta");
  check("a gust alone (no mean) is not flagged", !classifyReading({ sunTempF: 120, shadeTempF: 98, windGustMph: 7 }).flagged);
}

console.log("\nChecking the wind model against the crew");
{
  // A straight street running north-south at lng -71.06, three parallel
  // streets 100 m apart so each reading has an unambiguous nearest edge.
  const lngs = [-71.0600, -71.0588, -71.0576];
  const nodes = lngs.flatMap((lng) => [
    { c: [lng, 42.350] as [number, number] },
    { c: [lng, 42.352] as [number, number] },
  ]);
  const edges = lngs.map((_, i) => ({ a: i * 2, b: i * 2 + 1, len: 222, name: `Street ${i}`, geom: [] as [number, number][] }));
  const adj = nodes.map((_, n) => [Math.floor(n / 2)]);
  const network: WalkNetwork = { generatedAt: "", nodes, edges, adj };

  const near1 = nearestEdge(network, [-71.0588, 42.351]);
  check("the nearest edge to a point on a street is that street", near1?.edge === 1 && near1.distanceM < 1, `(${JSON.stringify(near1)})`);
  const mid = nearestEdge(network, [-71.0585, 42.351]);
  check("a point 25 m off a street is still nearest to it", mid?.edge === 1 && near(mid.distanceM, 25, 3), `(${JSON.stringify(mid)})`);
  check("a point far from every street reports its distance", (nearestEdge(network, [-71.0500, 42.351])?.distanceM ?? 0) > 500);

  // Model: street 0 sheltered (0.30), street 1 middling (0.50), street 2 exposed (0.90),
  // identical for every sector so the test isolates ranking, not direction.
  const ratios = Array.from({ length: 16 }, () => [30, 50, 90]);
  const model = { ratios };

  const t0 = new Date("2026-10-10T18:00:00.000Z");
  const loganAt = (mph: number): LoganObservation[] => [{ time: t0.toISOString(), mph, fromDeg: 270 }];
  const reading = (i: number, streetLng: number, mph: number): FieldWindReading => ({
    id: `r${i}`, siteCode: `CT-${i}`, recordedAt: new Date(t0.getTime() + 5 * 60_000).toISOString(),
    lat: 42.351, lng: streetLng, windMph: mph, windGustMph: null, windFrom: i % 2 ? "W" : null,
  });
  const many = (measure: (modelRatio: number) => number, n = 18): FieldWindReading[] =>
    Array.from({ length: n }, (_, i) => {
      const street = i % 3;
      return reading(i, lngs[street], measure([0.30, 0.50, 0.90][street]) * 15);
    });

  const perfect = compareWindToCrew(network, model, many((r) => r), loganAt(15));
  check("every on-network reading is used", perfect.n === 18, `(n=${perfect.n}, skipped ${JSON.stringify(perfect.skipped)})`);
  check("a crew that measured exactly what the model says: rank agreement 1", perfect.spearman !== null && near(perfect.spearman, 1, 1e-9));
  check("... and the verdict is 'agrees'", perfect.verdict === "agrees");
  check("... with no bias and no error", near(perfect.medianBias ?? 99, 1, 1e-9) && near(perfect.meanAbsError ?? 99, 0, 1e-9));
  check("the ratio is measured speed over Logan's speed", near(perfect.rows[0].measuredRatio, 0.30, 1e-9));

  const backwards = compareWindToCrew(network, model, many((r) => 1.2 - r), loganAt(15));
  check("a street the model calls calm that the crew finds windy: rank agreement -1", backwards.spearman !== null && near(backwards.spearman, -1, 1e-9));
  check("... and the verdict is 'disagrees'", backwards.verdict === "disagrees");

  const biased = compareWindToCrew(network, model, many((r) => r * 2), loganAt(15));
  check("a crew that finds everything twice as windy: ranking still agrees, bias is 2", biased.verdict === "agrees" && near(biased.medianBias ?? 0, 2, 1e-9));

  const noisy = compareWindToCrew(network, model, many(() => 0.4), loganAt(15));
  check("identical readings everywhere give no rank agreement to claim (undefined, not zero)", noisy.spearman === null && noisy.verdict === "insufficient");

  const few = compareWindToCrew(network, model, many((r) => r, MIN_READINGS_FOR_VERDICT - 1), loganAt(15));
  check("too few readings never produce a verdict", few.verdict === "insufficient", `(n=${few.n})`);

  const skippedTime = compareWindToCrew(network, model, many((r) => r), [
    { time: new Date(t0.getTime() - 6 * 3600_000).toISOString(), mph: 15, fromDeg: 270 },
  ]);
  check("readings with no Logan observation within 45 minutes are skipped, and counted", skippedTime.n === 0 && skippedTime.skipped["no-logan-observation"] === 18);

  const calm = compareWindToCrew(network, model, many((r) => r), [{ time: t0.toISOString(), mph: 1, fromDeg: null }]);
  check("a calm Logan hour is skipped (a ratio to nothing means nothing)", calm.n === 0 && calm.skipped["logan-calm"] === 18);

  const farAway = compareWindToCrew(network, model, [{ ...reading(0, -71.0500, 5) }], loganAt(15));
  check("a reading nowhere near a sidewalk is skipped, and counted", farAway.n === 0 && farAway.skipped["far-from-network"] === 1);

  check("spearman of identical orderings is 1", spearman([1, 2, 3, 4], [10, 20, 30, 40]) === 1);
  check("spearman handles ties without inventing order", near(spearman([1, 1, 2, 2], [1, 2, 3, 4]) ?? 0, 0.894, 0.01));
  check("spearman of a constant series is undefined", spearman([1, 1, 1], [1, 2, 3]) === null);
}

console.log(
  failures === 0
    ? "\nAll wind checks passed.\n"
    : `\n${failures} wind check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
