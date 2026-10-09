/**
 * Builds Boston wind climatology from real observations: Boston Logan
 * (KBOS) hourly METARs from the Iowa Environmental Mesonet, 2010-2025.
 *
 * For each of the four representative dates the shade model already uses,
 * and for every hour of the local day, it records which way the wind
 * usually blows and how hard — from the observations within +/-30 days of
 * that date, across all years. "Typical wind for this season and hour" is
 * therefore a measured statistic, not a guess, and it is static data like
 * everything else here: no weather service is called at request time.
 *
 * Honest limits, repeated in the app: Logan sits on the open harbour, so
 * these are open-terrain 10 m winds, stronger than anything between
 * Chinatown's buildings. They set the DIRECTION and a reference speed; the
 * wind model (scripts/build-wind.ts) decides how each street changes it.
 *
 * Run with: npm run build:wind-climate
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SECTOR_COUNT,
  sectorOf,
  type WindClimate,
  type WindClimateHour,
} from "../src/lib/wind";

const OUT_DIR = join(process.cwd(), "public", "data", "wind");
const FIRST_YEAR = 2010;
const LAST_YEAR = 2025;
const WINDOW_DAYS = 30;
const KNOTS_TO_MPH = 1.15078;
/** Below this the wind is "calm" for pedestrian purposes and has no useful direction. */
const CALM_KNOTS = 3;

type Obs = { dayOfYear: number; hour: number; knots: number; dir: number };

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 0);
  return Math.floor((Date.UTC(year, month - 1, day) - start) / 86_400_000);
}

async function fetchYear(year: number): Promise<Obs[]> {
  const params = new URLSearchParams({
    station: "BOS",
    year1: String(year),
    month1: "1",
    day1: "1",
    year2: String(year + 1),
    month2: "1",
    day2: "1",
    tz: "America/New_York",
    format: "onlycomma",
    latlon: "no",
    missing: "M",
    trace: "T",
    direct: "no",
    report_type: "3",
  });
  for (const d of ["sknt", "drct"]) params.append("data", d);

  const res = await fetch(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params}`);
  if (!res.ok) throw new Error(`IEM ${year} responded ${res.status}`);
  const text = await res.text();

  const out: Obs[] = [];
  for (const line of text.split("\n").slice(1)) {
    const [, valid, sknt, drct] = line.split(",");
    if (!valid || sknt === "M" || sknt === undefined) continue;
    const knots = Number(sknt);
    if (!Number.isFinite(knots)) continue;
    const dir = drct === "M" ? Number.NaN : Number(drct);
    // "2024-07-01 00:54"
    const [datePart, timePart] = valid.split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const hour = Number(timePart.slice(0, 2));
    out.push({ dayOfYear: dayOfYear(y, m, d), hour, knots, dir });
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const index = JSON.parse(
    await readFile(join(process.cwd(), "public", "data", "shade", "index.json"), "utf8"),
  ) as { dates: Array<{ dateKey: string; date: string }> };

  const all: Obs[] = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    process.stdout.write(`  fetching ${year}… `);
    const rows = await fetchYear(year);
    console.log(`${rows.length} observations`);
    all.push(...rows);
  }
  console.log(`\n${all.length} hourly observations, ${FIRST_YEAR}-${LAST_YEAR}\n`);

  const dates: WindClimate["dates"] = {};

  for (const { dateKey, date } of index.dates) {
    const [, m, d] = date.split("-").map(Number);
    const centre = dayOfYear(2027, m, d);
    const inWindow = (obs: Obs) => {
      const gap = Math.abs(obs.dayOfYear - centre);
      return Math.min(gap, 366 - gap) <= WINDOW_DAYS;
    };

    const hours: WindClimateHour[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const rows = all.filter((o) => o.hour === hour && inWindow(o));
      const calm = rows.filter((o) => o.knots < CALM_KNOTS || Number.isNaN(o.dir));
      const moving = rows.filter((o) => o.knots >= CALM_KNOTS && !Number.isNaN(o.dir));

      const bySector: number[][] = Array.from({ length: SECTOR_COUNT }, () => []);
      for (const o of moving) bySector[sectorOf(o.dir)].push(o.knots * KNOTS_TO_MPH);

      const total = Math.max(1, moving.length);
      hours.push({
        n: rows.length,
        calmFraction: rows.length ? Math.round((calm.length / rows.length) * 100) / 100 : 0,
        // Share of NON-calm observations from each direction sector.
        frequency: bySector.map((s) => Math.round((s.length / total) * 1000) / 1000),
        // Median speed (mph) when the wind does blow from that sector.
        speedMph: bySector.map((s) => Math.round(median(s) * 10) / 10),
        medianMph: Math.round(median(moving.map((o) => o.knots * KNOTS_TO_MPH)) * 10) / 10,
      });
    }
    dates[dateKey] = { windowDays: WINDOW_DAYS, hours };

    const noon = hours[13];
    const top = noon.frequency.indexOf(Math.max(...noon.frequency));
    console.log(
      `${dateKey.padEnd(16)} 1pm: wind mostly from sector ${top} ` +
        `(${(noon.frequency[top] * 100).toFixed(0)}% of non-calm hours), ` +
        `median ${noon.medianMph} mph, calm ${(noon.calmFraction * 100).toFixed(0)}%`,
    );
  }

  const climate: WindClimate = {
    generatedAt: new Date().toISOString(),
    source: "Boston Logan International Airport (KBOS) hourly METAR, Iowa Environmental Mesonet",
    years: [FIRST_YEAR, LAST_YEAR],
    sectorCount: SECTOR_COUNT,
    referenceHeightM: 10,
    calmKnots: CALM_KNOTS,
    dates,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "climate.json"), JSON.stringify(climate));
  console.log(`\nWrote public/data/wind/climate.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
