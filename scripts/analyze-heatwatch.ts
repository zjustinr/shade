/**
 * Independent check of the shade model against CAPA's Heat Watch Boston 2019
 * street-level air temperatures (research/heatwatch-2019/README.md).
 *
 * Question: along the afternoon (about 3:00-3:56pm) drives, were the car
 * sensor's points that our model puts in shade cooler than the ones it puts
 * in sun?
 *
 *   npm run analyze:heatwatch        (about 6 minutes: it computes the shade
 *                                     for each 5-minute bin on the real date)
 *
 * PRIMARY test, pre-specified before any result was seen, and left unchanged
 * when the study area grew:
 *   - points: the afternoon points inside the Chinatown box;
 *   - shade = the point lies inside the modelled building OR tree shadow,
 *     computed for July 29, 2019 at the time of the reading with the same
 *     model and City data the public map uses;
 *   - effect = within-drive difference in air temperature, shaded minus
 *     sunlit (a separate baseline for each drive, so warming between drives
 *     does not masquerade as a shade effect);
 *   - significance = circular-shift permutation test (keeps the strong
 *     second-to-second autocorrelation, which a plain t-test would ignore).
 * The SECOND analysis uses every afternoon point in the whole study area
 * (more drives, more streets). It was added after the primary result was
 * known, and also removes a linear time trend inside each drive. Everything
 * other than the primary is exploratory; do not cherry-pick.
 *
 * Writes research/heatwatch-2019/results.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from "geojson";
import { STUDY_AREA_CENTRE } from "../src/lib/chinatown";
import { computeShade, type ShadeResult } from "../src/lib/shade";

type Reading = {
  timeN: number; // hhmmss, UTC
  lat: number;
  lng: number;
  speed: number;
  tF: number;
  inChinatown: boolean;
};

const DATA_DIR = join(process.cwd(), "public", "data");
const POINTS_CSV = join(process.cwd(), "research", "heatwatch-2019", "study-area-points.csv");
const RESULTS_MD = join(process.cwd(), "research", "heatwatch-2019", "results.md");

const PERMUTATIONS = 10000;
const PASS_GAP_SECONDS = 60;
const BIN_MINUTES = 5;
const LOCAL_RADIUS_M = 15;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hmsToSeconds(timeN: number): number {
  return Math.floor(timeN / 10000) * 3600 + (Math.floor(timeN / 100) % 100) * 60 + (timeN % 100);
}

function loadReadings(csv: string): Reading[] {
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  const cols = head.split(",");
  const at = (name: string) => cols.indexOf(name);
  return lines
    .map((line) => line.trim().split(","))
    .filter((c) => c[at("slot")] === "afternoon")
    .map((c) => ({
      timeN: Number(c[at("time_n")]),
      lat: Number(c[at("lat")]),
      lng: Number(c[at("long")]),
      speed: Number(c[at("speed")]),
      tF: Number(c[at("T_F")]),
      inChinatown: c[at("in_chinatown")] === "1",
    }))
    .sort((a, b) => a.timeN - b.timeN);
}

/** Split into drives wherever the clock jumps by more than a minute. */
function splitPasses(readings: Reading[]): Reading[][] {
  const passes: Reading[][] = [];
  for (const r of readings) {
    const last = passes[passes.length - 1];
    if (last && hmsToSeconds(r.timeN) - hmsToSeconds(last[last.length - 1].timeN) <= PASS_GAP_SECONDS) {
      last.push(r);
    } else {
      passes.push([r]);
    }
  }
  return passes;
}

/** Bounding-box prefilter in front of the exact test: the shade layers hold thousands of rings. */
type ShadeLookup = (lng: number, lat: number) => boolean;
function lookupFor(feature: Feature<Polygon | MultiPolygon> | null): ShadeLookup {
  if (!feature) return () => false;
  const polys: Position[][][] =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const boxes = polys.map((rings) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY] as const;
  });
  return (lng, lat) => {
    for (let i = 0; i < polys.length; i++) {
      const b = boxes[i];
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      if (booleanPointInPolygon(point([lng, lat]), { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: polys[i] } })) {
        return true;
      }
    }
    return false;
  };
}

type Lookups = { building: ShadeLookup; tree: ShadeLookup; sunAltitudeDeg: number };

/** Shaded share of the point and a ring of 8 around it (about one street width). */
function localShadeFraction(l: Lookups, lng: number, lat: number): number {
  const dLat = LOCAL_RADIUS_M / 111320;
  const dLng = LOCAL_RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));
  let shaded = 0;
  for (let k = -1; k < 8; k++) {
    const angle = k < 0 ? 0 : (k * Math.PI) / 4;
    const r = k < 0 ? 0 : 1;
    const x = lng + r * dLng * Math.cos(angle);
    const y = lat + r * dLat * Math.sin(angle);
    if (l.building(x, y) || l.tree(x, y)) shaded++;
  }
  return shaded / 9;
}

type Series = { xs: number[][]; ys: number[][]; zs?: number[][]; ts: number[][] };

/** Remove the per-drive mean, and optionally a per-drive linear trend in time. */
function residualize(values: number[], times: number[], detrend: boolean): number[] {
  const n = values.length;
  const mv = values.reduce((s, v) => s + v, 0) / n;
  if (!detrend || n < 3) return values.map((v) => v - mv);
  const mt = times.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (times[i] - mt) * (values[i] - mv);
    den += (times[i] - mt) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  return values.map((v, i) => v - mv - slope * (times[i] - mt));
}

/** Fixed-effects slope of y on x (and optionally on z), per drive; y-units per x-unit. */
function slopeOf(s: Series, xs: number[][], detrend: boolean): number {
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (let p = 0; p < xs.length; p++) {
    const x = residualize(xs[p], s.ts[p], detrend);
    const y = residualize(s.ys[p], s.ts[p], detrend);
    const z = s.zs ? residualize(s.zs[p], s.ts[p], detrend) : null;
    for (let i = 0; i < x.length; i++) {
      sxx += x[i] * x[i];
      sxy += x[i] * y[i];
      if (z) {
        sxz += x[i] * z[i];
        szz += z[i] * z[i];
        szy += z[i] * y[i];
      }
    }
  }
  if (!s.zs) return sxx > 1e-12 ? sxy / sxx : NaN;
  const det = sxx * szz - sxz * sxz;
  return det > 1e-9 ? (szz * sxy - sxz * szy) / det : NaN;
}

function circularShift<T>(arr: T[], by: number): T[] {
  return arr.map((_, i) => arr[(i + by) % arr.length]);
}

function permutationTest(s: Series, detrend: boolean, seed: number) {
  const observed = slopeOf(s, s.xs, detrend);
  const rand = mulberry32(seed);
  let twoSided = 0;
  let cooler = 0;
  for (let n = 0; n < PERMUTATIONS; n++) {
    const shifted = s.xs.map((x) => circularShift(x, Math.floor(rand() * x.length)));
    const b = slopeOf(s, shifted, detrend);
    if (Math.abs(b) >= Math.abs(observed) - 1e-12) twoSided++;
    if (b <= observed + 1e-12) cooler++;
  }
  return {
    observed,
    pTwoSided: (twoSided + 1) / (PERMUTATIONS + 1),
    pCooler: (cooler + 1) / (PERMUTATIONS + 1),
  };
}

async function main() {
  const all = loadReadings(await readFile(POINTS_CSV, "utf8"));
  const inputs = {
    buildings: JSON.parse(await readFile(join(DATA_DIR, "buildings.geojson"), "utf8")) as FeatureCollection<Polygon | MultiPolygon>,
    trees: JSON.parse(await readFile(join(DATA_DIR, "trees.geojson"), "utf8")) as FeatureCollection<Point>,
    buildingHeightProperty: "height_m",
    treeCrownRadiusProperty: "crown_radius_m",
    treeHeightProperty: "height_m",
  };

  const lookupCache = new Map<string, Lookups>();
  const lookupsFor = (day: number, timeN: number): Lookups => {
    const bin = Math.floor(hmsToSeconds(timeN) / (BIN_MINUTES * 60));
    const key = `${day}:${bin}`;
    let l = lookupCache.get(key);
    if (!l) {
      const instant = new Date(Date.UTC(2019, 6, day, 0, 0, 0) + (bin * BIN_MINUTES * 60 + (BIN_MINUTES * 30)) * 1000);
      const shade: ShadeResult = computeShade(inputs, instant, STUDY_AREA_CENTRE);
      l = { building: lookupFor(shade.buildingShade), tree: lookupFor(shade.treeShade), sunAltitudeDeg: shade.sun.altitudeDeg };
      lookupCache.set(key, l);
      console.error(`shade for July ${day}, bin ${bin} (${lookupCache.size} computed)`);
    }
    return l;
  };

  type Set = { name: string; readings: Reading[]; day: number };
  const chinatown = all.filter((r) => r.inChinatown);
  console.error(`loaded ${all.length} afternoon points, ${chinatown.length} in the Chinatown box`);
  if (chinatown.length === 0) throw new Error("no Chinatown points: check the CSV columns");
  const sets: Set[] = [
    { name: "Chinatown box", readings: chinatown, day: 29 },
    { name: "whole study area", readings: all, day: 29 },
  ];

  const lines: string[] = [];
  const tableRows: string[] = [];
  let primary: ReturnType<typeof permutationTest> | null = null;
  let seed = 20190729;

  const record = (label: string, s: Series, detrend: boolean) => {
    const t = permutationTest(s, detrend, seed++);
    const n = s.xs.reduce((a, x) => a + x.length, 0);
    tableRows.push(
      `| ${label} | ${n} | ${s.xs.length} | ${t.observed >= 0 ? "+" : ""}${t.observed.toFixed(2)} | ${t.pTwoSided.toFixed(3)} | ${t.pCooler.toFixed(3)} |`,
    );
    return t;
  };

  for (const set of sets) {
    const passes = splitPasses(set.readings);
    const build = (pick: (r: Reading, l: Lookups) => number, day = set.day) =>
      passes.map((pass) => pass.map((r) => pick(r, lookupsFor(day, r.timeN))));
    const ts = passes.map((p) => p.map((r) => hmsToSeconds(r.timeN)));
    const ys = passes.map((p) => p.map((r) => r.tF));
    const speeds = passes.map((p) => p.map((r) => r.speed));
    const binary = build((r, l) => (l.building(r.lng, r.lat) || l.tree(r.lng, r.lat) ? 1 : 0));
    const building = build((r, l) => (l.building(r.lng, r.lat) ? 1 : 0));
    const tree = build((r, l) => (l.tree(r.lng, r.lat) ? 1 : 0));

    const n = set.readings.length;
    const shadedN = binary.flat().reduce((a, v) => a + v, 0);
    const speedOf = (flag: number) => {
      const v = binary.flatMap((b, p) => b.map((x, i) => (x === flag ? speeds[p][i] : NaN)).filter((q) => !Number.isNaN(q)));
      return v.reduce((a, c) => a + c, 0) / v.length;
    };
    lines.push(
      `**${set.name}:** ${n} afternoon points in ${passes.length} drives; ${shadedN} (${((100 * shadedN) / n).toFixed(0)}%) in modelled shade ` +
        `(building ${building.flat().reduce((a, v) => a + v, 0)}, tree ${tree.flat().reduce((a, v) => a + v, 0)}). ` +
        `Mean vehicle speed ${speedOf(1).toFixed(1)} in shade vs ${speedOf(0).toFixed(1)} in sun (units not stated in the source).`,
    );

    const base: Series = { xs: binary, ys, ts };
    const detrend = set.name !== "Chinatown box";
    const tag = set.name === "Chinatown box" ? "Chinatown box" : "study area";
    const suffix = detrend ? ", per-drive time trend removed" : "";

    if (set.name === "Chinatown box") {
      primary = record(`PRIMARY: ${tag}, in modelled shade (yes/no)`, base, false);
      record(`exploratory: ${tag}, building shade only`, { ...base, xs: building }, false);
      record(`exploratory: ${tag}, tree shade only`, { ...base, xs: tree }, false);
      record(`exploratory: ${tag}, adjusting for vehicle speed`, { ...base, zs: speeds }, false);
      const local = build((r, l) => localShadeFraction(l, r.lng, r.lat));
      record(`exploratory: ${tag}, shaded share within ${LOCAL_RADIUS_M} m (0-1)`, { ...base, xs: local }, false);
      const day30 = build((r, l) => (l.building(r.lng, r.lat) || l.tree(r.lng, r.lat) ? 1 : 0), 30);
      record(`exploratory: ${tag}, July 30 instead of July 29`, { ...base, xs: day30 }, false);
    } else {
      record(`second analysis: ${tag}, in modelled shade${suffix}`, base, true);
      record(`exploratory: ${tag}, building shade only${suffix}`, { ...base, xs: building }, true);
      record(`exploratory: ${tag}, tree shade only${suffix}`, { ...base, xs: tree }, true);
      record(`exploratory: ${tag}, adjusting for vehicle speed${suffix}`, { ...base, zs: speeds }, true);
      // Drop points where the car was nearly stopped (queues, signals).
      const moving = passes.map((pass) => pass.map((r) => r.speed >= 10));
      const keep = (arr: number[][]) => arr.map((a, p) => a.filter((_, i) => moving[p][i]));
      const mv: Series = { xs: keep(binary), ys: keep(ys), ts: keep(ts) };
      const nonEmpty = mv.xs.map((x) => x.length >= 5);
      const filt = (arr: number[][]) => arr.filter((_, p) => nonEmpty[p]);
      record(`exploratory: ${tag}, only points with speed >= 10${suffix}`, { xs: filt(mv.xs), ys: filt(mv.ys), ts: filt(mv.ts) }, true);
    }
  }

  const altitudes = [...lookupCache.values()].map((l) => l.sunAltitudeDeg);
  const md = [
    "# Heat Watch 2019 vs the shade model: afternoon drives",
    "",
    "Generated by `npm run analyze:heatwatch`. Read the caveats before quoting anything here.",
    "",
    "## Data",
    ...lines.map((l) => `- ${l}`),
    `- Shade is computed for the real date and clock time (July 29, 2019; 5-minute bins; sun altitude ${Math.min(...altitudes).toFixed(0)}-${Math.max(...altitudes).toFixed(0)} degrees), using the shade layer's own model and City data.`,
    "",
    "## Result",
    "Effect = air-temperature difference in degrees F per unit of shade, within each drive (negative = shade is cooler).",
    "p values come from 10,000 circular-shift permutations, which respect the strong second-to-second autocorrelation.",
    "",
    "| Test | n | drives | Effect (F) | p, two-sided | p, shade cooler |",
    "|---|---|---|---|---|---|",
    ...tableRows,
    "",
    "Only the PRIMARY row was pre-specified. The second analysis was added after the primary result was known, because the study area grew and brought many more drives into range. Treat everything else as exploratory.",
    "",
    "## Caveats (all of them matter)",
    "- **Neighbouring points are almost the same measurement.** The permutation test accounts for that, but the effective sample is the number of drives and shadow crossings, not the number of points.",
    "- **Air temperature in a moving car, not sidewalk surface temperature.** Air a metre or two above a road barely differs between sun and shade, so a null or small effect would not mean the shade map is wrong.",
    "- **The vehicle is on the road;** the shade model's accuracy is claimed for sidewalks. GPS error of a few metres can flip a point across a shadow edge.",
    "- **Buildings are 2010 heights; trees are estimated from trunk diameter;** 79 buildings have no usable height and cast no shadow. Elevated roads and tunnels (I-93, the Mass Pike) are in the study area and a car on them is not in the street shade the model describes.",
    "- **The date is not in the data.** The campaign ran July 29 and 30, 2019. Switching the date moves the effect size by only 0.03 F (+0.46 to +0.49) but moves the p value from 0.09 to 0.02, which shows how fragile p values are on about three drives. With eleven tests listed, a single p below 0.05 means nothing, and it is in the wrong direction for a shade effect anyway.",
    "- **Temperature is recorded in coarse steps** (0.1 C), and values repeat from second to second.",
    "",
    `Primary result: ${primary ? `${primary.observed.toFixed(2)} F, two-sided p = ${primary.pTwoSided.toFixed(3)}` : "n/a"}.`,
    "",
  ].join("\n");

  await writeFile(RESULTS_MD, md);
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
