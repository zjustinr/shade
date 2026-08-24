/**
 * Precomputes shadow geometry for the Chinatown bbox at 30-minute
 * intervals across four representative dates, and writes it as static
 * GeoJSON (SPEC §6 Performance).
 *
 * Doing the unions here rather than in the browser is the whole point:
 * the map snaps to the nearest half-hour at runtime and never computes a
 * union on a slider tick.
 *
 * Run with: npm run build:shade  (after npm run extract:data)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from "geojson";
import { CHINATOWN_CENTRE } from "../src/lib/chinatown";
import { computeShade } from "../src/lib/shade";
import { roundGeometry } from "../src/lib/geojson-precision";

const DATA_DIR = join(process.cwd(), "public", "data");
const OUT_DIR = join(DATA_DIR, "shade");

/**
 * Douglas-Peucker tolerance in degrees, ~1 m. The model's own error is far
 * larger than a metre, so simplifying to this costs no real accuracy and
 * keeps each slot small enough to fetch on a phone.
 */
const SIMPLIFY_TOLERANCE = 0.00001;

/** Equinoxes and solstices — the four dates that bracket the year's
 *  sun angles (§6). Chosen for 2027, the summer the validation pass runs. */
const REPRESENTATIVE_DATES = [
  { key: "spring-equinox", date: "2027-03-20" },
  { key: "summer-solstice", date: "2027-06-21" },
  { key: "autumn-equinox", date: "2027-09-23" },
  { key: "winter-solstice", date: "2027-12-21" },
] as const;

/** 6am-8pm local, matching the public map's time slider (§7). */
const START_HOUR = 6;
const END_HOUR = 20;
const STEP_MINUTES = 30;

/**
 * Boston is UTC-5 (EST) or UTC-4 (EDT). Rather than pull in a tz library,
 * derive the offset for each date from the IANA database via Intl, so the
 * precomputed slots line up with the wall-clock times the slider shows.
 */
function bostonOffsetHours(utcDate: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  });
  const part = formatter
    .formatToParts(utcDate)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = part?.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) : -5;
}

/** Builds the UTC instant for a given local wall-clock time in Boston. */
function bostonWallClockToUtc(dateIso: string, hour: number, minute: number): Date {
  const naive = new Date(`${dateIso}T${pad(hour)}:${pad(minute)}:00Z`);
  const offset = bostonOffsetHours(naive);
  return new Date(naive.getTime() - offset * 3600 * 1000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Simplify and round one shadow layer down to a servable size. */
function compact(
  shadow: Feature<Polygon | MultiPolygon>,
  kind: "building" | "tree",
): Feature {
  let geometry = shadow.geometry;
  try {
    geometry = turf.simplify(turf.feature(geometry), {
      tolerance: SIMPLIFY_TOLERANCE,
      highQuality: false,
    }).geometry as Polygon | MultiPolygon;
  } catch {
    // Simplification can fail on a degenerate ring; the unsimplified
    // geometry is still correct, just larger.
  }
  return {
    type: "Feature",
    geometry: roundGeometry(geometry),
    properties: { kind },
  };
}

async function main() {
  const buildings = JSON.parse(
    await readFile(join(DATA_DIR, "buildings.geojson"), "utf8"),
  ) as FeatureCollection<Polygon | MultiPolygon>;
  const trees = JSON.parse(
    await readFile(join(DATA_DIR, "trees.geojson"), "utf8"),
  ) as FeatureCollection<Point>;

  await mkdir(OUT_DIR, { recursive: true });

  const inputs = {
    buildings,
    trees,
    buildingHeightProperty: "height_m",
    treeCrownRadiusProperty: "crown_radius_m",
    treeHeightProperty: "height_m",
  };

  const index: Array<{
    dateKey: string;
    date: string;
    slots: Array<{ time: string; belowHorizon: boolean; sunAltitudeDeg: number }>;
  }> = [];

  let skippedBuildings = 0;
  const startedAt = Date.now();

  for (const { key, date } of REPRESENTATIVE_DATES) {
    const slots: Array<{ time: string; belowHorizon: boolean; sunAltitudeDeg: number }> = [];
    const dayDir = join(OUT_DIR, key);
    await mkdir(dayDir, { recursive: true });
    let dayBytes = 0;

    for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
      for (let minute = 0; minute < 60; minute += STEP_MINUTES) {
        if (hour === END_HOUR && minute > 0) break;

        const instant = bostonWallClockToUtc(date, hour, minute);
        const result = computeShade(inputs, instant, CHINATOWN_CENTRE);
        // Only a daytime slot reports a meaningful skipped count; the
        // below-horizon early return never looks at the buildings.
        if (!result.belowHorizon) skippedBuildings = result.skippedBuildings;

        const time = `${pad(hour)}:${pad(minute)}`;
        slots.push({
          time,
          belowHorizon: result.belowHorizon,
          sunAltitudeDeg: Number(result.sun.altitudeDeg.toFixed(2)),
        });

        // One file per half-hour: the map fetches only the slot it is
        // showing, instead of a multi-megabyte whole-day bundle.
        const features: Feature[] = [];
        // Building and tree shade stay separate so the map can render tree
        // shadows lighter — they are the less certain of the two (§14).
        if (result.buildingShade) {
          features.push(compact(result.buildingShade, "building"));
        }
        if (result.treeShade) {
          features.push(compact(result.treeShade, "tree"));
        }

        const collection: FeatureCollection = { type: "FeatureCollection", features };
        const json = JSON.stringify(collection);
        dayBytes += json.length;
        await writeFile(join(dayDir, `${pad(hour)}${pad(minute)}.geojson`), json);
      }
    }

    index.push({ dateKey: key, date, slots });
    console.log(
      `${key}: ${slots.length} slots, ${(dayBytes / 1024 / 1024).toFixed(1)} MB total, ` +
        `${(dayBytes / slots.length / 1024).toFixed(0)} KB avg per slot`,
    );
  }

  await writeFile(
    join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        stepMinutes: STEP_MINUTES,
        startHour: START_HOUR,
        endHour: END_HOUR,
        timezone: "America/New_York",
        buildingsTotal: buildings.features.length,
        buildingsSkippedNoHeight: skippedBuildings,
        treesTotal: trees.features.length,
        dates: index,
      },
      null,
      2,
    ),
  );

  console.log(
    `\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. ` +
      `${skippedBuildings} buildings skipped for want of a height.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
