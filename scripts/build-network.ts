/**
 * Builds the routable pedestrian network for the Chinatown bbox.
 *
 * Source is Boston's Sidewalk Centerline layer, which is a genuine
 * pedestrian network — sidewalk centrelines plus the crosswalks that
 * connect them across intersections — rather than street centrelines. For a
 * project about where to walk in the shade, routing along the sidewalk
 * people actually use, on the side of the street that is actually shaded,
 * is the whole point: the two sides of one street can differ by tens of
 * degrees, and a street-centreline graph cannot express that.
 *
 * Written as a static file so routing needs no server and works offline.
 *
 * Run with: npm run build:network
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { CHINATOWN_BBOX } from "../src/lib/chinatown";
import { metresBetween, type WalkNetwork } from "../src/lib/network";
import { COORD_PRECISION } from "../src/lib/geojson-precision";

const OUT_DIR = join(process.cwd(), "public", "data");

const SIDEWALKS_URL =
  "https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/5/query";
const STREETS_URL =
  "https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/8/query";

/**
 * Which pedestrian ways to include.
 * - SWALK-CL   sidewalk centreline
 * - CWALK-CL   marked crosswalk — needed or the two sides of a street never connect
 * - PWALK-CL   path or plaza walk, including park paths
 * - CWALK-CL-UM unmarked crossing. Included because excluding it fragments the
 *   graph, but an unmarked crossing is a worse place to send someone, so it
 *   carries a cost multiplier rather than being treated as equal.
 */
const INCLUDED_TYPES = new Set(["SWALK-CL", "CWALK-CL", "PWALK-CL", "CWALK-CL-UM"]);

/** Nodes closer together than this are the same junction. Sidewalk and
 *  crosswalk endpoints rarely coincide to the millimetre. */
const SNAP_METRES = 3;

/** A street name is attached to a sidewalk if a street centreline runs
 *  within this distance of the sidewalk's midpoint. */
const NAME_MATCH_METRES = 30;

type Coord = [number, number];

function bboxParams(pad = 0) {
  const { west, south, east, north } = CHINATOWN_BBOX;
  return new URLSearchParams({
    where: "1=1",
    geometry: `${west - pad},${south - pad},${east + pad},${north + pad}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    f: "geojson",
  });
}

async function fetchLines(url: string, outFields: string, pad = 0) {
  const params = bboxParams(pad);
  params.set("outFields", outFields);
  const res = await fetch(`${url}?${params}`);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  const data = (await res.json()) as FeatureCollection & {
    exceededTransferLimit?: boolean;
  };
  if (data.exceededTransferLimit) {
    throw new Error(`${url} hit the transfer limit — add paging before trusting this.`);
  }
  return (data.features ?? []).filter(
    (f): f is Feature<LineString> => f.geometry?.type === "LineString",
  );
}

function round(n: number) {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(n * factor) / factor;
}

/** Spatial hash so node snapping is not O(n^2) over every vertex. */
class NodeIndex {
  private cells = new Map<string, number[]>();
  readonly coords: Coord[] = [];
  /** ~3 m at this latitude. */
  private readonly cell = 0.00004;

  private key(lng: number, lat: number) {
    return `${Math.floor(lng / this.cell)}:${Math.floor(lat / this.cell)}`;
  }

  add(coord: Coord): number {
    // Check the 9 neighbouring cells for an existing node within SNAP_METRES.
    const cx = Math.floor(coord[0] / this.cell);
    const cy = Math.floor(coord[1] / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const index of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (metresBetween(this.coords[index], coord) <= SNAP_METRES) return index;
        }
      }
    }
    const index = this.coords.length;
    this.coords.push(coord);
    const k = this.key(coord[0], coord[1]);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(index);
    else this.cells.set(k, [index]);
    return index;
  }
}

async function main() {
  console.log("Fetching Boston sidewalk centrelines for the Chinatown bbox…");
  const sidewalks = await fetchLines(SIDEWALKS_URL, "OBJECTID,TYPE");
  console.log(`  ${sidewalks.length} pedestrian ways`);

  console.log("Fetching street centrelines (for street names)…");
  const streets = await fetchLines(STREETS_URL, "ST_NAME,ST_TYPE,PRE_DIR,SUF_DIR");
  console.log(`  ${streets.length} street segments`);

  // Street name lookup: midpoint of each street segment plus its name.
  const namedPoints: Array<{ c: Coord; name: string }> = [];
  for (const street of streets) {
    const p = street.properties ?? {};
    const name = [p.PRE_DIR, p.ST_NAME, p.ST_TYPE, p.SUF_DIR]
      .filter((part) => part != null && String(part).trim() !== "")
      .join(" ")
      .trim();
    if (!name) continue;
    for (const c of street.geometry.coordinates as Coord[]) {
      namedPoints.push({ c, name });
    }
  }

  function nameNear(point: Coord): string | null {
    let best: string | null = null;
    let bestDistance = NAME_MATCH_METRES;
    for (const candidate of namedPoints) {
      // Cheap bbox reject before the trigonometry.
      if (Math.abs(candidate.c[0] - point[0]) > 0.0005) continue;
      if (Math.abs(candidate.c[1] - point[1]) > 0.0005) continue;
      const d = metresBetween(candidate.c, point);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate.name;
      }
    }
    return best;
  }

  const index = new NodeIndex();
  const edges: WalkNetwork["edges"] = [];
  const kinds: string[] = [];
  let skippedShort = 0;

  for (const way of sidewalks) {
    const type = String(way.properties?.TYPE ?? "");
    if (!INCLUDED_TYPES.has(type)) continue;

    const coords = (way.geometry.coordinates as Coord[]).map(
      (c) => [round(c[0]), round(c[1])] as Coord,
    );
    if (coords.length < 2) continue;

    const a = index.add(coords[0]);
    const b = index.add(coords[coords.length - 1]);
    if (a === b) {
      // A loop that snapped onto itself carries no connectivity.
      skippedShort += 1;
      continue;
    }

    let len = 0;
    for (let i = 1; i < coords.length; i++) len += metresBetween(coords[i - 1], coords[i]);
    if (len < 0.5) {
      skippedShort += 1;
      continue;
    }

    const mid = coords[Math.floor(coords.length / 2)];
    edges.push({
      a,
      b,
      len: Math.round(len * 10) / 10,
      name: type.startsWith("CWALK") ? null : nameNear(mid),
      geom: coords.slice(1, -1),
    });
    kinds.push(type);
  }

  const nodes = index.coords.map((c) => ({ c }));
  const adj: number[][] = Array.from({ length: nodes.length }, () => []);
  edges.forEach((edge, i) => {
    adj[edge.a].push(i);
    adj[edge.b].push(i);
  });

  // Keep only the largest connected component. Stray fragments would let the
  // planner offer a start point it can never route out of.
  const component = new Int32Array(nodes.length).fill(-1);
  let componentCount = 0;
  const sizes: number[] = [];
  for (let start = 0; start < nodes.length; start++) {
    if (component[start] !== -1) continue;
    const id = componentCount++;
    let size = 0;
    const stack = [start];
    component[start] = id;
    while (stack.length) {
      const node = stack.pop()!;
      size += 1;
      for (const edgeIndex of adj[node]) {
        const edge = edges[edgeIndex];
        const next = edge.a === node ? edge.b : edge.a;
        if (component[next] === -1) {
          component[next] = id;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  const biggest = sizes.indexOf(Math.max(...sizes));

  const keepNode = new Int32Array(nodes.length).fill(-1);
  const keptNodes: WalkNetwork["nodes"] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (component[i] === biggest) {
      keepNode[i] = keptNodes.length;
      keptNodes.push(nodes[i]);
    }
  }
  const keptEdges: WalkNetwork["edges"] = [];
  const keptKinds: string[] = [];
  edges.forEach((edge, i) => {
    if (keepNode[edge.a] === -1 || keepNode[edge.b] === -1) return;
    keptEdges.push({ ...edge, a: keepNode[edge.a], b: keepNode[edge.b] });
    keptKinds.push(kinds[i]);
  });
  const keptAdj: number[][] = Array.from({ length: keptNodes.length }, () => []);
  keptEdges.forEach((edge, i) => {
    keptAdj[edge.a].push(i);
    keptAdj[edge.b].push(i);
  });

  const network: WalkNetwork = {
    generatedAt: new Date().toISOString(),
    nodes: keptNodes,
    edges: keptEdges,
    adj: keptAdj,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "network.json"), JSON.stringify(network));
  await writeFile(
    join(OUT_DIR, "network-kinds.json"),
    JSON.stringify({ kinds: keptKinds }),
  );

  const named = keptEdges.filter((e) => e.name).length;
  const totalM = keptEdges.reduce((sum, e) => sum + e.len, 0);
  console.log(
    `\nNetwork: ${keptNodes.length} nodes, ${keptEdges.length} edges, ` +
      `${(totalM / 1000).toFixed(1)} km of walkway`,
  );
  console.log(`  ${named} edges carry a street name`);
  console.log(`  ${componentCount} components found; kept the largest (${sizes[biggest]} nodes)`);
  console.log(`  dropped ${nodes.length - keptNodes.length} nodes off the main network`);
  console.log(`  skipped ${skippedShort} degenerate ways`);

  const raw = await readFile(join(OUT_DIR, "network.json"), "utf8");
  console.log(`  network.json is ${(raw.length / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
