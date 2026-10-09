/**
 * Fetches building footprints for a PADDED area around Chinatown, for the
 * wind model only.
 *
 * Why: the shade model's building extract is clipped to the Chinatown box,
 * which is right for shade but wrong for wind. Wind arriving at the edge of
 * the box has crossed the buildings just outside it; with those missing,
 * every street on the boundary looks like an open field and comes out
 * artificially windy. The wind model looks up to 250 m upwind, so this
 * pulls a 280 m margin.
 *
 * Output goes to scripts/data/ (build input, committed for reproducibility)
 * and is deliberately NOT written to public/ — the app never needs it, and
 * it would only bloat the download and the iOS bundle.
 *
 * Run with: npm run extract:wind-context
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { CHINATOWN_BBOX } from "../src/lib/chinatown";
import { COORD_PRECISION } from "../src/lib/geojson-precision";

const BUILDINGS_URL =
  "https://gis.bostonplans.org/hosting/rest/services/Boston_Buildings/FeatureServer/9/query";
const FEET_TO_METRES = 0.3048;
const PAGE_SIZE = 2000;

/** Margin in degrees: ~280 m of latitude, ~280 m of longitude at 42.35 N. */
const PAD_LAT = 280 / 111_132;
const PAD_LNG = 280 / (111_320 * Math.cos((42.3515 * Math.PI) / 180));

const round = (n: number) => {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
};

async function main() {
  const { west, south, east, north } = CHINATOWN_BBOX;
  const geometry = [west - PAD_LNG, south - PAD_LAT, east + PAD_LNG, north + PAD_LAT].join(",");

  const raw: Feature[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "OBJECTID,BLDG_HGT_2010",
      geometry,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
    });
    const res = await fetch(`${BUILDINGS_URL}?${params}`);
    if (!res.ok) throw new Error(`${BUILDINGS_URL} responded ${res.status}`);
    const page = (await res.json()) as { features?: Feature[]; error?: { message: string } };
    if (page.error) throw new Error(page.error.message);
    const batch = page.features ?? [];
    raw.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  // One feature per polygon: a MultiPolygon becomes several obstacles.
  const features: Feature<Polygon>[] = [];
  let noHeight = 0;
  for (const f of raw) {
    const geom = f.geometry as Polygon | MultiPolygon | null;
    if (!geom) continue;
    const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    const heightFt = Number(f.properties?.BLDG_HGT_2010);
    const heightM = Number.isFinite(heightFt) && heightFt > 0 ? heightFt * FEET_TO_METRES : null;
    if (heightM === null) noHeight += 1;
    polygons.forEach((rings, i) => {
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          // Outer ring only: courtyards do not matter at this scale.
          coordinates: [rings[0].map(([lng, lat]) => [round(lng), round(lat)])],
        },
        properties: {
          id: `${f.properties?.OBJECTID}-${i}`,
          height_m: heightM === null ? null : Number(heightM.toFixed(2)),
        },
      });
    });
  }

  const out = join(process.cwd(), "scripts", "data");
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "wind-context-buildings.geojson"),
    JSON.stringify({
      type: "FeatureCollection",
      features,
      metadata: {
        source: "City of Boston Buildings (BPDA), BLDG_HGT_2010",
        purpose: "Wind-model context: padded footprints so boundary streets are not read as open ground.",
        extracted_at: new Date().toISOString(),
        bbox: CHINATOWN_BBOX,
        pad_metres: 280,
      },
    }),
  );
  console.log(
    `${features.length} footprints (${noHeight} source buildings with no height) ` +
      `in the padded area -> scripts/data/wind-context-buildings.geojson`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
