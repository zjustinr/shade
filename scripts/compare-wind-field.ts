/**
 * Compares the wind model with what the field crew measured.
 *
 * Usage:
 *   npm run compare:wind -- path/to/readings.csv
 *
 * The CSV is the admin console's "Export CSV" (columns include
 * recorded_at, lat, lng, wind_mph, wind_gust_mph, wind_from). Only readings
 * with a wind speed are used. For the dates covered, it downloads the
 * matching hourly Boston Logan observations from the Iowa Environmental
 * Mesonet, turns each crew reading into a ratio against Logan at that hour,
 * and compares it with the model's ratio for the nearest sidewalk.
 *
 * It states a verdict only when there are enough readings, and says what
 * the verdict does and does not mean. See src/lib/wind-validation.ts and
 * docs/wind-model.md.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WalkNetwork } from "../src/lib/network";
import {
  MIN_READINGS_FOR_VERDICT,
  compareWindToCrew,
  type FieldWindReading,
  type LoganObservation,
} from "../src/lib/wind-validation";

const DATA = join(process.cwd(), "public", "data");
const KNOTS_TO_MPH = 1.15078;

/** Minimal CSV reader for this project's own export: quoted cells, "" escapes. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function toReadings(rows: Array<Record<string, string>>): FieldWindReading[] {
  const out: FieldWindReading[] = [];
  for (const r of rows) {
    const windMph = r.wind_mph === "" || r.wind_mph === undefined ? NaN : Number(r.wind_mph);
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(windMph) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: r.reading_id,
      siteCode: r.site_code || null,
      recordedAt: r.recorded_at,
      lat,
      lng,
      windMph,
      windGustMph: r.wind_gust_mph ? Number(r.wind_gust_mph) : null,
      windFrom: r.wind_from || null,
    });
  }
  return out;
}

async function fetchLogan(from: Date, to: Date): Promise<LoganObservation[]> {
  const pad = 24 * 3600_000;
  const a = new Date(from.getTime() - pad);
  const b = new Date(to.getTime() + pad);
  const params = new URLSearchParams({
    station: "BOS",
    year1: String(a.getUTCFullYear()), month1: String(a.getUTCMonth() + 1), day1: String(a.getUTCDate()),
    year2: String(b.getUTCFullYear()), month2: String(b.getUTCMonth() + 1), day2: String(b.getUTCDate()),
    tz: "Etc/UTC", format: "onlycomma", latlon: "no", missing: "M", trace: "T", direct: "no",
    report_type: "3",
  });
  for (const d of ["sknt", "drct"]) params.append("data", d);
  const res = await fetch(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params}`);
  if (!res.ok) throw new Error(`IEM responded ${res.status}`);
  const text = await res.text();
  const out: LoganObservation[] = [];
  for (const line of text.split("\n").slice(1)) {
    const [, valid, sknt, drct] = line.split(",");
    if (!valid || !sknt || sknt === "M") continue;
    const knots = Number(sknt);
    if (!Number.isFinite(knots)) continue;
    out.push({
      time: new Date(`${valid.replace(" ", "T")}:00Z`).toISOString(),
      mph: knots * KNOTS_TO_MPH,
      fromDeg: drct === "M" || drct === undefined || Number.isNaN(Number(drct)) ? null : Number(drct),
    });
  }
  return out;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run compare:wind -- path/to/readings.csv");
    process.exit(2);
  }
  const readings = toReadings(parseCsv(await readFile(path, "utf8")));
  if (readings.length === 0) {
    console.log("No readings with a wind speed in that file yet. Nothing to compare.");
    return;
  }

  const times = readings.map((r) => new Date(r.recordedAt).getTime());
  const network = JSON.parse(await readFile(join(DATA, "network.json"), "utf8")) as WalkNetwork;
  const model = JSON.parse(await readFile(join(DATA, "wind", "ratios.json"), "utf8")) as { ratios: number[][]; edgeCount: number };
  if (model.edgeCount !== network.edges.length) {
    throw new Error("wind ratios.json does not match network.json — rebuild both (npm run build:wind).");
  }

  console.log(`${readings.length} readings with wind. Fetching Logan observations…`);
  const observations = await fetchLogan(new Date(Math.min(...times)), new Date(Math.max(...times)));
  console.log(`${observations.length} Logan observations around those dates.\n`);

  const result = compareWindToCrew(network, model, readings, observations);

  console.log(`Used ${result.n} of ${readings.length} readings.`);
  for (const [reason, count] of Object.entries(result.skipped)) {
    if (count) console.log(`  skipped ${count}: ${reason}`);
  }
  if (result.n === 0) return;

  console.log("\nsite     measured  logan  measured/logan  model   crew-dir model");
  for (const r of result.rows) {
    console.log(
      `${(r.siteCode ?? "—").padEnd(8)} ${r.measuredMph.toFixed(1).padStart(7)}  ${r.loganMph.toFixed(1).padStart(5)}  ` +
        `${r.measuredRatio.toFixed(2).padStart(14)}  ${r.modelRatio.toFixed(2).padStart(5)}  ` +
        `${r.modelRatioCrewDirection === null ? "     —" : r.modelRatioCrewDirection.toFixed(2).padStart(10)}`,
    );
  }

  console.log("\nSummary");
  console.log(`  rank agreement (Spearman): ${result.spearman === null ? "undefined" : result.spearman.toFixed(2)}`);
  console.log(`  median measured/model:     ${result.medianBias === null ? "—" : result.medianBias.toFixed(2)}  (above 1: the street is windier than the model says)`);
  console.log(`  mean absolute error:       ${result.meanAbsError === null ? "—" : result.meanAbsError.toFixed(2)}  (in units of open-ground wind)`);

  const words: Record<typeof result.verdict, string> = {
    insufficient: `NOT ENOUGH DATA — need at least ${MIN_READINGS_FOR_VERDICT} usable readings for any verdict (have ${result.n}).`,
    agrees: "The model ranks streets the way the crew measured them (rank agreement of 0.5 or more).",
    weak: "Weak agreement (0.2 to 0.5). The model has some signal but should not be leaned on.",
    disagrees: "The model does NOT rank streets the way the crew measured them. Do not present its wind figures as reliable.",
  };
  console.log(`\nVerdict: ${words[result.verdict]}`);
  console.log(
    "\nWhat this does and does not tell you: it tests the model's RANKING of streets against a few\n" +
      "short handheld measurements. Each reading is a 30-60 second average against an hourly airport\n" +
      "observation, so individual points are noisy; trust the pattern over many readings, not any one.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
