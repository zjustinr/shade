/**
 * Extracts the open City data the shade model needs, clips it to the
 * Chinatown bbox, and writes it into the repo as static GeoJSON.
 *
 * SPEC §5: resolve endpoints at build time and cache in-repo — never fetch
 * City APIs at request time.
 *
 * Run with: npm run extract:data
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from "geojson";
import { CHINATOWN_BBOX } from "../src/lib/chinatown";
import { crownRadiusM, parseDbhInches, treeHeightM } from "../src/lib/tree-allometry";
import { roundGeometry } from "../src/lib/geojson-precision";

// Written into public/ so the map fetches these as static assets rather than
// bundling them into the JS payload (§10: <300KB JS on the public map route).
const OUT_DIR = join(process.cwd(), "public", "data");

// Verified live 2026-08. If one of these moves, re-resolve it from its
// dataset page on data.boston.gov rather than guessing a new path.
const TREES_URL =
  "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/BPRD_Trees/FeatureServer/0/query";

// Note the layer index: this FeatureServer exposes only layer 9.
const BUILDINGS_URL =
  "https://gis.bostonplans.org/hosting/rest/services/Boston_Buildings/FeatureServer/9/query";

const FEET_TO_METRES = 0.3048;
const PAGE_SIZE = 2000;

/** GeoJSON permits foreign members on a FeatureCollection; provenance rides
 *  along with the data so /about can cite it without a second lookup. */
type WithMetadata<T> = T & { metadata: Record<string, unknown> };

function bboxParams() {
  const { west, south, east, north } = CHINATOWN_BBOX;
  return {
    geometry: `${west},${south},${east},${north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    f: "geojson",
  };
}

async function fetchAllPages(
  baseUrl: string,
  outFields: string,
): Promise<Feature[]> {
  const features: Feature[] = [];
  let offset = 0;

  for (;;) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields,
      ...bboxParams(),
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
    });

    const res = await fetch(`${baseUrl}?${params}`);
    if (!res.ok) {
      throw new Error(`${baseUrl} responded ${res.status} ${res.statusText}`);
    }
    const page = (await res.json()) as FeatureCollection & { error?: { message: string } };
    if (page.error) throw new Error(`ArcGIS error: ${page.error.message}`);

    const batch = page.features ?? [];
    features.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return features;
}

async function extractTrees() {
  console.log("Fetching BPRD trees in the Chinatown bbox…");
  const raw = await fetchAllPages(TREES_URL, "ObjectId,id,spp_com,spp_bot,dbh,dbh_range,park");

  let withDbh = 0;
  const features = raw
    .filter((f): f is Feature<Point> => f.geometry?.type === "Point")
    .map((f) => {
      const dbhInches = parseDbhInches(f.properties?.dbh);
      if (dbhInches != null) withDbh += 1;
      return {
        type: "Feature" as const,
        geometry: roundGeometry(f.geometry),
        properties: {
          id: f.properties?.id ?? f.properties?.ObjectId ?? null,
          species_common: f.properties?.spp_com ?? null,
          species_botanical: f.properties?.spp_bot ?? null,
          dbh_inches: dbhInches,
          // Estimated, not measured — see src/lib/tree-allometry.ts.
          crown_radius_m: Number(crownRadiusM(dbhInches).toFixed(2)),
          height_m: Number(treeHeightM(dbhInches).toFixed(2)),
          height_source: dbhInches != null ? "estimated_from_dbh" : "default",
          in_park: Boolean(f.properties?.park),
        },
      };
    });

  const collection: WithMetadata<FeatureCollection<Point>> = {
    type: "FeatureCollection",
    features,
    metadata: {
      source: "City of Boston Open Data — BPRD Trees",
      source_url: "https://data.boston.gov/dataset/bprd-trees",
      extracted_at: new Date().toISOString(),
      bbox: CHINATOWN_BBOX,
      count: features.length,
      with_measured_dbh: withDbh,
      note:
        "crown_radius_m and height_m are ESTIMATED from trunk dbh. The source layer carries no crown or height field.",
    },
  };

  await writeFile(join(OUT_DIR, "trees.geojson"), JSON.stringify(collection));
  console.log(`  ${features.length} trees (${withDbh} with a measured dbh)`);
  return { count: features.length, withDbh };
}

async function extractBuildings() {
  console.log("Fetching building footprints in the Chinatown bbox…");
  const raw = await fetchAllPages(
    BUILDINGS_URL,
    "OBJECTID,BLDG_HGT_2010,GRND_ELEV_2010,ROOF_ELEV_2010,IEL_TYPE,Land_Use",
  );

  let skippedNoHeight = 0;
  const features = raw
    .filter(
      (f): f is Feature<Polygon | MultiPolygon> =>
        f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
    )
    .map((f) => {
      // BLDG_HGT_2010 is in FEET (service units are esriFeet); the shade
      // model works in metres.
      const heightFt = Number(f.properties?.BLDG_HGT_2010);
      const heightM =
        Number.isFinite(heightFt) && heightFt > 0 ? heightFt * FEET_TO_METRES : null;
      // §14: skip buildings with no height rather than guessing tall.
      if (heightM == null) skippedNoHeight += 1;

      return {
        type: "Feature" as const,
        geometry: roundGeometry(f.geometry),
        properties: {
          id: f.properties?.OBJECTID ?? null,
          height_m: heightM == null ? null : Number(heightM.toFixed(2)),
          height_ft: Number.isFinite(heightFt) ? Number(heightFt.toFixed(2)) : null,
          structure_type: f.properties?.IEL_TYPE ?? null,
          land_use: f.properties?.Land_Use ?? null,
        },
      };
    });

  const collection: WithMetadata<FeatureCollection<Polygon | MultiPolygon>> = {
    type: "FeatureCollection",
    features,
    metadata: {
      source: "City of Boston Open Data — Boston Buildings with Roof Breaks (BPDA)",
      source_url: "https://data.boston.gov/dataset/boston-buildings-with-roof-breaks",
      extracted_at: new Date().toISOString(),
      bbox: CHINATOWN_BBOX,
      count: features.length,
      skipped_no_height: skippedNoHeight,
      note:
        "Heights are from a 2010/2011 flyover, converted from feet to metres. 'Roof breaks' means one building may be several polygons at different heights.",
    },
  };

  await writeFile(join(OUT_DIR, "buildings.geojson"), JSON.stringify(collection));
  console.log(`  ${features.length} building parts (${skippedNoHeight} with no usable height)`);
  return { count: features.length, skippedNoHeight };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const trees = await extractTrees();
  const buildings = await extractBuildings();

  await writeFile(
    join(OUT_DIR, "extract-summary.json"),
    JSON.stringify(
      {
        extracted_at: new Date().toISOString(),
        bbox: CHINATOWN_BBOX,
        trees,
        buildings,
      },
      null,
      2,
    ),
  );

  console.log("\nWrote public/data/{trees,buildings}.geojson and extract-summary.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
