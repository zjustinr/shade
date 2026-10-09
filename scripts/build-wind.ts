/**
 * Applies the street-level wind model (src/lib/wind-model.ts) to every
 * walkway edge for each of the 16 wind-direction sectors, and writes the
 * result as static JSON the app reads. Same pattern as the shade exposure:
 * heavy work at build time, a lookup at runtime.
 *
 * It also reports how much the results depend on the one input the source
 * data could not supply — the heights of the 79 buildings with none — and
 * prints the windiest and calmest streets for a few winds, so the output
 * can be read against what people who know downtown Boston expect.
 *
 * Run with: npm run build:wind   (after build:network)
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Feature, Polygon } from "geojson";
import { edgeLine, type WalkNetwork } from "../src/lib/network";
import { SECTOR_COUNT, SECTOR_NAMES, sectorCentreDeg } from "../src/lib/wind";
import {
  ObstacleIndex,
  bearingBetween,
  makeObstacle,
  makeProjection,
  type Metric,
  type Obstacle,
} from "../src/lib/urban-geometry";
import { ASSUMED_HEIGHT_M, windAtPoint } from "../src/lib/wind-model";
import { CHINATOWN_BBOX } from "../src/lib/chinatown";

const DATA = join(process.cwd(), "public", "data");

/** Sample each edge at these fractions of its length and average the speeds:
 *  a single point can land beside an odd corner and misstate a whole block. */
const SAMPLE_FRACTIONS = [0.25, 0.5, 0.75];

const projection = makeProjection(
  (CHINATOWN_BBOX.south + CHINATOWN_BBOX.north) / 2,
  (CHINATOWN_BBOX.west + CHINATOWN_BBOX.east) / 2,
);

function loadObstacles(
  features: Feature<Polygon>[],
  assumedHeight: number,
): { obstacles: Obstacle[]; assumed: number } {
  const obstacles: Obstacle[] = [];
  let assumed = 0;
  for (const f of features) {
    const ring: Metric[] = f.geometry.coordinates[0].map(([lng, lat]) =>
      projection.toMetric(lng, lat),
    );
    const known = Number(f.properties?.height_m);
    const hasHeight = Number.isFinite(known) && known > 0;
    if (!hasHeight) assumed += 1;
    obstacles.push(
      makeObstacle(
        String(f.properties?.id ?? obstacles.length),
        ring,
        hasHeight ? known : assumedHeight,
        !hasHeight,
      ),
    );
  }
  return { obstacles, assumed };
}

/** Points along an edge's polyline, in metres, with the street bearing at each. */
function edgeSamples(network: WalkNetwork, edgeIndex: number) {
  const edge = network.edges[edgeIndex];
  const line = edgeLine(network, edgeIndex, edge.a).map(([lng, lat]) =>
    projection.toMetric(lng, lat),
  );
  const lengths: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]),
    );
  }
  const total = lengths[lengths.length - 1] || 1;

  return SAMPLE_FRACTIONS.map((fraction) => {
    const target = total * fraction;
    let i = 1;
    while (i < line.length - 1 && lengths[i] < target) i++;
    const seg = lengths[i] - lengths[i - 1] || 1;
    const t = (target - lengths[i - 1]) / seg;
    const point: Metric = [
      line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
      line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
    ];
    return { point, bearing: bearingBetween(line[i - 1], line[i]) };
  });
}

function computeRatios(
  network: WalkNetwork,
  index: ObstacleIndex,
  sectors: number[],
): Map<number, number[]> {
  const ctx = { index };
  const samples = network.edges.map((_, i) => edgeSamples(network, i));
  const out = new Map<number, number[]>();
  for (const sector of sectors) {
    const from = sectorCentreDeg(sector);
    out.set(
      sector,
      samples.map((points) => {
        const mean =
          points.reduce((s, p) => s + windAtPoint(ctx, p.point, p.bearing, from).ratio, 0) /
          points.length;
        return mean;
      }),
    );
  }
  return out;
}

/** Spearman rank correlation: do two runs rank the streets the same way? */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    order.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  return num / Math.sqrt(da * db);
}

async function main() {
  const network = JSON.parse(
    await readFile(join(DATA, "network.json"), "utf8"),
  ) as WalkNetwork;
  // The padded footprints (extract:wind-context) are what the model needs:
  // wind reaching the edge of the study box has crossed the buildings just
  // outside it. The clipped shade extract is only a fallback, and says so —
  // its boundary streets would read as open ground.
  const contextPath = join(process.cwd(), "scripts", "data", "wind-context-buildings.geojson");
  const usingContext = existsSync(contextPath);
  const buildings = JSON.parse(
    await readFile(usingContext ? contextPath : join(DATA, "buildings.geojson"), "utf8"),
  ) as { features: Feature<Polygon>[] };
  if (!usingContext) {
    console.warn(
      "WARNING: scripts/data/wind-context-buildings.geojson not found — using the clipped " +
        "shade extract. Streets on the study-area boundary will be too windy. " +
        "Run `npm run extract:wind-context` first.\n",
    );
  }

  const base = loadObstacles(buildings.features, ASSUMED_HEIGHT_M);
  console.log(
    `${base.obstacles.length} buildings (${base.assumed} with no height, ` +
      `assumed ${ASSUMED_HEIGHT_M} m), ${network.edges.length} edges\n`,
  );

  const started = Date.now();
  const allSectors = Array.from({ length: SECTOR_COUNT }, (_, i) => i);
  const baseRatios = computeRatios(network, new ObstacleIndex(base.obstacles), allSectors);
  console.log(`Model run: ${((Date.now() - started) / 1000).toFixed(1)} s\n`);

  // --- Sensitivity to the assumed height of the 79 unknown buildings ---
  console.log("Sensitivity to the assumed height of buildings with none recorded");
  const probe = [4, 8, 12]; // W, E-ish and NNE-ish probes: sectors 12, 4, ...
  for (const alt of [6, 20]) {
    const variant = loadObstacles(buildings.features, alt);
    const ratios = computeRatios(network, new ObstacleIndex(variant.obstacles), probe);
    for (const sector of probe) {
      const b = baseRatios.get(sector)!;
      const v = ratios.get(sector)!;
      const meanAbs = b.reduce((s, x, i) => s + Math.abs(x - v[i]), 0) / b.length;
      console.log(
        `  assume ${String(alt).padStart(2)} m, wind from ${SECTOR_NAMES[sector].padEnd(3)}: ` +
          `mean change ${meanAbs.toFixed(3)} (of ~${(b.reduce((s, x) => s + x, 0) / b.length).toFixed(2)}), ` +
          `street ranking agreement (Spearman) ${spearman(b, v).toFixed(3)}`,
      );
    }
  }

  // --- Output ---
  const ratios: number[][] = allSectors.map((s) =>
    baseRatios.get(s)!.map((r) => Math.round(r * 100)),
  );
  await mkdir(join(DATA, "wind"), { recursive: true });
  await writeFile(
    join(DATA, "wind", "ratios.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      model:
        "Screening model: upwind obstruction-angle shelter, Gandemer corner/downwash amplification, enclosed-street channelling. Relative index, not measured speed.",
      sectorCount: SECTOR_COUNT,
      edgeCount: network.edges.length,
      buildingsTotal: base.obstacles.length,
      paddedContext: usingContext,
      buildingsAssumedHeight: base.assumed,
      assumedHeightM: ASSUMED_HEIGHT_M,
      ratios,
    }),
  );

  // --- Is the study-area boundary still special? ---
  // If missing outside buildings were making boundary streets artificially
  // open, edges near the box edge would be windier than interior edges for
  // winds blowing in from outside. Compare them.
  {
    const inset = 0.0004; // ~35-45 m
    const nearBoundary = network.edges.map((edge) => {
      const [lng, lat] = network.nodes[edge.a].c;
      return (
        lng < CHINATOWN_BBOX.west + inset ||
        lng > CHINATOWN_BBOX.east - inset ||
        lat < CHINATOWN_BBOX.south + inset ||
        lat > CHINATOWN_BBOX.north - inset
      );
    });
    console.log("\nBoundary check (mean ratio, boundary edges vs interior edges)");
    for (const sector of [4, 8, 12, 0]) {
      const r = baseRatios.get(sector)!;
      const mean = (flag: boolean) => {
        const xs = r.filter((_, i) => nearBoundary[i] === flag);
        return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      };
      console.log(
        `  from ${SECTOR_NAMES[sector].padEnd(3)}: boundary ${mean(true).toFixed(3)} ` +
          `(${nearBoundary.filter(Boolean).length} edges)  interior ${mean(false).toFixed(3)}`,
      );
    }
  }

  // --- Read-out for a human who knows downtown Boston ---
  const describe = (e: number) => {
    const edge = network.edges[e];
    const [lng, lat] = network.nodes[edge.a].c;
    return `${(edge.name ?? "walkway/crossing").padEnd(24)} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  };

  console.log("\nDistribution of the pedestrian-level ratio (share of edges)");
  for (const sector of [4, 12, 14]) {
    const r = baseRatios.get(sector)!;
    const sorted = [...r].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))].toFixed(2);
    const over1 = ((r.filter((x) => x > 1).length / r.length) * 100).toFixed(0);
    console.log(
      `  from ${SECTOR_NAMES[sector].padEnd(3)}: min ${q(0)}  p25 ${q(0.25)}  median ${q(0.5)}  ` +
        `p75 ${q(0.75)}  max ${q(1)}   (${over1}% of edges amplified above open-ground speed)`,
    );
  }

  for (const sector of [12, 4]) {
    const r = baseRatios.get(sector)!;
    const order = r.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
    console.log(`\nWindiest 6 edges for wind from the ${SECTOR_NAMES[sector]}:`);
    for (const [x, i] of order.slice(0, 6)) console.log(`  ${x.toFixed(2)}  ${describe(i)}`);
    console.log(`Calmest 4 edges for wind from the ${SECTOR_NAMES[sector]}:`);
    for (const [x, i] of order.slice(-4).reverse()) console.log(`  ${x.toFixed(2)}  ${describe(i)}`);
  }

  const bytes = (await readFile(join(DATA, "wind", "ratios.json"))).length;
  console.log(`\nWrote public/data/wind/ratios.json (${(bytes / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
