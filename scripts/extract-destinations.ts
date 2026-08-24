/**
 * Extracts everyday walking destinations for the Chinatown area and caches
 * them as static GeoJSON, following the same rule as the other City data
 * (§5): resolved at build time, never fetched at request time.
 *
 * See src/lib/destinations.ts for the positioning rule these must respect —
 * destinations to walk to, not a cooling-resources directory.
 *
 * Run with: npm run extract:destinations
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { CHINATOWN_BBOX } from "../src/lib/chinatown";
import { COORD_PRECISION } from "../src/lib/geojson-precision";
import type { Destination, DestinationCategory } from "../src/lib/destinations";

const OUT_DIR = join(process.cwd(), "public", "data");

/**
 * Destinations are pulled from a slightly larger box than the map extent.
 * People walk to the pharmacy just past the edge of the neighbourhood, and
 * clipping exactly to the bbox would hide destinations that are a two-minute
 * walk away. ~0.004 degrees is roughly 350-450 m here.
 */
const PAD = 0.004;

type Source = {
  category: DestinationCategory;
  label: string;
  url: string;
  nameFields: string[];
  addressFields: string[];
  /** Optional predicate to drop rows that are not really destinations. */
  keep?: (props: Record<string, unknown>) => boolean;
};

// Every endpoint below was verified live against the Chinatown bbox.
const SOURCES: Source[] = [
  {
    category: "pharmacy",
    label: "Pharmacies (2024)",
    url: "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Pharmacies_2024_WFL1/FeatureServer/0/query",
    nameFields: ["USER_Organization_Name", "PlaceName"],
    addressFields: ["Match_addr"],
  },
  {
    category: "library",
    label: "Boston Public Library branches",
    url: "https://gisportal.boston.gov/arcgis/rest/services/CityServices/OpenData/MapServer/6/query",
    nameFields: ["BRANCH"],
    addressFields: ["ST_ADDRESS"],
  },
  {
    category: "hospital",
    label: "Hospitals",
    url: "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Hospitals_2026_0403/FeatureServer/0/query",
    nameFields: ["NAME", "SHORT_NAME"],
    addressFields: ["ADDRESS"],
  },
  {
    category: "health_center",
    label: "Community health centers",
    url: "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/HealthCenters_2026_0403/FeatureServer/0/query",
    nameFields: ["NAME", "SHORT_NAME"],
    addressFields: ["ADDRESS"],
  },
  {
    category: "public_housing",
    label: "Boston Housing Authority developments",
    url: "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/BHA_Developments/FeatureServer/0/query",
    nameFields: ["DEVELOPMEN"],
    addressFields: ["MAIN_ADDRE"],
  },
  {
    category: "restaurant",
    label: "Restaurants (InfoUSA 2020)",
    url: "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Restaurants_InfoUSA_2020/FeatureServer/0/query",
    nameFields: ["COMPANY_NA"],
    addressFields: ["ADDRESS"],
  },
  {
    category: "park",
    label: "Public open space",
    url: "https://gisportal.boston.gov/arcgis/rest/services/BaseServices/Open_Space_Public/FeatureServer/0/query",
    nameFields: ["SITE_NAME", "ALT_NAME"],
    addressFields: ["ADDRESS"],
  },
];

function round(n: number) {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(n * factor) / factor;
}

/** Representative point for a feature: the point itself, or a polygon's
 *  average vertex, which for these compact parks sits inside the shape. */
function representativePoint(geometry: Geometry): [number, number] | null {
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    return [lng, lat];
  }
  const positions: Position[] = [];
  const walk = (coords: unknown) => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      positions.push(coords as Position);
    } else if (Array.isArray(coords)) {
      coords.forEach(walk);
    }
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  if (positions.length === 0) return null;
  const lng = positions.reduce((s, p) => s + p[0], 0) / positions.length;
  const lat = positions.reduce((s, p) => s + p[1], 0) / positions.length;
  return [lng, lat];
}

function firstString(
  props: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const value = props[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

/** Source data is inconsistently cased and spaced; tidy it for display. */
function tidy(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  const lettersOnly = collapsed.replace(/[^A-Za-z]/g, "");
  const shouting =
    lettersOnly.length > 3 && lettersOnly === lettersOnly.toUpperCase();
  if (!shouting) return collapsed;
  return collapsed
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Cvs|Bha|Mbta)\b/g, (m) => m.toUpperCase());
}

async function fetchSource(source: Source) {
  const { west, south, east, north } = CHINATOWN_BBOX;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${west - PAD},${south - PAD},${east + PAD},${north + PAD}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    f: "geojson",
  });

  const res = await fetch(`${source.url}?${params}`);
  if (!res.ok) throw new Error(`${source.label} responded ${res.status}`);
  const data = (await res.json()) as FeatureCollection & {
    error?: { message: string };
  };
  if (data.error) throw new Error(`${source.label}: ${data.error.message}`);
  return data.features ?? [];
}

async function main() {
  const destinations: Destination[] = [];
  const summary: Array<{ category: string; label: string; count: number; note?: string }> =
    [];

  for (const source of SOURCES) {
    let features: Feature[] = [];
    try {
      features = await fetchSource(source);
    } catch (err) {
      console.error(`  ! ${source.label}: ${(err as Error).message}`);
      summary.push({
        category: source.category,
        label: source.label,
        count: 0,
        note: "fetch failed",
      });
      continue;
    }

    let kept = 0;
    for (const feature of features) {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      if (source.keep && !source.keep(props)) continue;
      if (!feature.geometry) continue;

      const point = representativePoint(feature.geometry);
      if (!point) continue;

      const rawName = firstString(props, source.nameFields);
      if (!rawName) continue;

      const rawAddress = firstString(props, source.addressFields);

      destinations.push({
        id: `${source.category}-${destinations.length}`,
        category: source.category,
        name: tidy(rawName),
        address: rawAddress ? tidy(rawAddress) : null,
        lng: round(point[0]),
        lat: round(point[1]),
      });
      kept += 1;
    }

    summary.push({ category: source.category, label: source.label, count: kept });
    console.log(`  ${source.label}: ${kept}`);
  }

  const collection = {
    type: "FeatureCollection" as const,
    features: destinations.map((d) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [d.lng, d.lat] },
      properties: {
        id: d.id,
        category: d.category,
        name: d.name,
        address: d.address,
      },
    })),
    metadata: {
      source: "City of Boston Open Data",
      extracted_at: new Date().toISOString(),
      bbox: CHINATOWN_BBOX,
      pad_degrees: PAD,
      note:
        "Everyday walking destinations, so the route planner can show which way there is shaded. NOT a cooling-resources directory — see SPEC §0 and src/lib/destinations.ts.",
      by_category: summary,
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "destinations.geojson"), JSON.stringify(collection));

  console.log(`\nWrote ${destinations.length} destinations to public/data/destinations.geojson`);
  for (const row of summary) {
    if (row.count === 0) {
      console.log(
        `  NOTE: no ${row.category} features found in or near the Chinatown bbox` +
          (row.note ? ` (${row.note})` : ""),
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
