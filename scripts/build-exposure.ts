/**
 * Computes how sun-exposed each walkway edge is, at each precomputed time
 * slot, for each representative date.
 *
 * This is what turns the shade model into routing: without it the planner
 * could only offer the shortest walk. Doing it at build time keeps the
 * browser's job to a lookup, which is what lets the planner run on a phone
 * with no signal.
 *
 * Run with: npm run build:exposure   (after build:network and build:shade)
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint, polygon as turfPolygon } from "@turf/helpers";
import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import { metresBetween, type WalkNetwork } from "../src/lib/network";
import type { ShadeIndex } from "../src/lib/shade-index";

const DATA_DIR = join(process.cwd(), "public", "data");
const SHADE_DIR = join(DATA_DIR, "shade");
const OUT_DIR = join(DATA_DIR, "exposure");

/** Sample the walkway every few metres. Finer than the shade model's own
 *  accuracy would be false precision; coarser and a short crosswalk gets a
 *  single sample and reads as all-sun or all-shade. */
const SAMPLE_SPACING_M = 5;
const MIN_SAMPLES_PER_EDGE = 2;

type Coord = [number, number];

/**
 * Grid index over the shade polygons. A slot's shade is one MultiPolygon
 * with hundreds of rings; testing every sample against every ring is
 * needlessly quadratic when a bbox lookup rejects almost all of them.
 */
class PolygonIndex {
  private cells = new Map<string, number[]>();
  private polygons: Feature<Polygon>[] = [];
  private bboxes: Array<[number, number, number, number]> = [];
  private readonly cell = 0.0005; // ~40-55 m

  add(rings: Position[][]) {
    const poly = turfPolygon(rings);
    const index = this.polygons.length;
    this.polygons.push(poly);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    this.bboxes.push([minX, minY, maxX, maxY]);

    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cy = Math.floor(minY / this.cell); cy <= Math.floor(maxY / this.cell); cy++) {
        const key = `${cx}:${cy}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(index);
        else this.cells.set(key, [index]);
      }
    }
  }

  contains(coord: Coord): boolean {
    const key = `${Math.floor(coord[0] / this.cell)}:${Math.floor(coord[1] / this.cell)}`;
    const candidates = this.cells.get(key);
    if (!candidates) return false;
    const pt = turfPoint(coord);
    for (const i of candidates) {
      const [minX, minY, maxX, maxY] = this.bboxes[i];
      if (coord[0] < minX || coord[0] > maxX || coord[1] < minY || coord[1] > maxY) continue;
      if (booleanPointInPolygon(pt, this.polygons[i])) return true;
    }
    return false;
  }

  get size() {
    return this.polygons.length;
  }
}

function buildIndex(collection: FeatureCollection): PolygonIndex {
  const index = new PolygonIndex();
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon") {
      index.add(geometry.coordinates);
    } else if (geometry.type === "MultiPolygon") {
      for (const rings of geometry.coordinates) index.add(rings);
    }
  }
  return index;
}

/** Points spaced along an edge's full polyline, endpoints included. */
function sampleEdge(network: WalkNetwork, edgeIndex: number): Coord[] {
  const edge = network.edges[edgeIndex];
  const line: Coord[] = [network.nodes[edge.a].c, ...edge.geom, network.nodes[edge.b].c];

  const wanted = Math.max(MIN_SAMPLES_PER_EDGE, Math.ceil(edge.len / SAMPLE_SPACING_M) + 1);
  const samples: Coord[] = [];

  // Walk the polyline, emitting a point every `step` metres of travel.
  const step = edge.len / (wanted - 1);
  let travelled = 0;
  let target = 0;
  samples.push(line[0]);
  target += step;

  for (let i = 1; i < line.length; i++) {
    const segmentLength = metresBetween(line[i - 1], line[i]);
    while (target <= travelled + segmentLength && samples.length < wanted) {
      const t = segmentLength === 0 ? 0 : (target - travelled) / segmentLength;
      samples.push([
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
      ]);
      target += step;
    }
    travelled += segmentLength;
  }
  if (samples.length < wanted) samples.push(line[line.length - 1]);
  return samples;
}

async function main() {
  const network = JSON.parse(
    await readFile(join(DATA_DIR, "network.json"), "utf8"),
  ) as WalkNetwork;
  const shadeIndex = JSON.parse(
    await readFile(join(SHADE_DIR, "index.json"), "utf8"),
  ) as ShadeIndex;

  await mkdir(OUT_DIR, { recursive: true });

  // Sample every edge once — the geometry does not change between slots.
  const samples = network.edges.map((_, i) => sampleEdge(network, i));
  const totalSamples = samples.reduce((sum, s) => sum + s.length, 0);
  console.log(
    `${network.edges.length} edges, ${totalSamples} sample points ` +
      `(~${SAMPLE_SPACING_M}m spacing)\n`,
  );

  const started = Date.now();

  for (const date of shadeIndex.dates) {
    const slots: Record<string, number[]> = {};
    const files = (await readdir(join(SHADE_DIR, date.dateKey))).filter((f) =>
      f.endsWith(".geojson"),
    );

    for (const file of files.sort()) {
      const time = `${file.slice(0, 2)}:${file.slice(2, 4)}`;
      const collection = JSON.parse(
        await readFile(join(SHADE_DIR, date.dateKey, file), "utf8"),
      ) as FeatureCollection;

      // No geometry means the sun is down: everywhere is shade, so nothing
      // is exposed. Recording 0 rather than omitting the slot keeps the
      // planner's lookup uniform.
      if (collection.features.length === 0) {
        slots[time] = new Array(network.edges.length).fill(0);
        continue;
      }

      const index = buildIndex(collection);
      const exposure = new Array<number>(network.edges.length);
      for (let e = 0; e < network.edges.length; e++) {
        const points = samples[e];
        let sunlit = 0;
        for (const p of points) if (!index.contains(p)) sunlit += 1;
        exposure[e] = Math.round((sunlit / points.length) * 100);
      }
      slots[time] = exposure;
    }

    const payload = { dateKey: date.dateKey, slots };
    await writeFile(join(OUT_DIR, `${date.dateKey}.json`), JSON.stringify(payload));

    const daytime = Object.entries(slots).filter(([, v]) => v.some((x) => x > 0));
    const meanExposure =
      daytime.length === 0
        ? 0
        : daytime.reduce(
            (sum, [, v]) => sum + v.reduce((a, b) => a + b, 0) / v.length,
            0,
          ) / daytime.length;
    const bytes = JSON.stringify(payload).length;
    console.log(
      `${date.dateKey}: ${Object.keys(slots).length} slots, ` +
        `mean daytime sun exposure ${meanExposure.toFixed(0)}%, ` +
        `${(bytes / 1024).toFixed(0)} KB`,
    );
  }

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
