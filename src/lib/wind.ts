/**
 * Shared wind vocabulary: compass sectors, the climatology file format, and
 * the plain words the UI uses. Model-independent — the numbers behind it
 * come from scripts/build-wind-climate.ts (observations) and
 * scripts/build-wind.ts (per-street model).
 *
 * Wind direction throughout follows the meteorological convention: the
 * direction the wind blows FROM, in degrees clockwise from north. A
 * "northwest wind" (315 degrees) blows from the northwest toward the
 * southeast.
 */

export const SECTOR_COUNT = 16;
export const SECTOR_WIDTH_DEG = 360 / SECTOR_COUNT; // 22.5

export const SECTOR_NAMES = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

/** Index 0 is north, centred on 0 degrees, so sector k is centred on k * 22.5. */
export function sectorOf(directionDeg: number): number {
  const wrapped = ((directionDeg % 360) + 360) % 360;
  return Math.round(wrapped / SECTOR_WIDTH_DEG) % SECTOR_COUNT;
}

export function sectorCentreDeg(sector: number): number {
  return (((sector % SECTOR_COUNT) + SECTOR_COUNT) % SECTOR_COUNT) * SECTOR_WIDTH_DEG;
}

export type WindClimateHour = {
  /** Observations behind this hour. */
  n: number;
  /** Share of observations too light or variable to have a direction. */
  calmFraction: number;
  /** Share of the non-calm observations from each sector. */
  frequency: number[];
  /** Median speed in mph when the wind blows from each sector. */
  speedMph: number[];
  /** Median speed in mph over all non-calm observations this hour. */
  medianMph: number;
};

export type WindClimate = {
  generatedAt: string;
  source: string;
  years: [number, number];
  sectorCount: number;
  referenceHeightM: number;
  calmKnots: number;
  dates: Record<string, { windowDays: number; hours: WindClimateHour[] }>;
};

export type TypicalWind = {
  /** The sector the wind most often blows from at this season and hour. */
  sector: number;
  /** Median open-terrain speed in mph when it does. */
  speedMph: number;
  /** Share of non-calm hours from that sector, 0-1. */
  frequency: number;
  calmFraction: number;
};

/** What "the usual wind" is for a given precomputed date and local hour. */
export function typicalWind(
  climate: WindClimate,
  dateKey: string,
  hour: number,
): TypicalWind | null {
  const row = climate.dates[dateKey]?.hours[Math.min(23, Math.max(0, Math.floor(hour)))];
  if (!row) return null;
  let best = 0;
  for (let s = 1; s < row.frequency.length; s++) {
    if (row.frequency[s] > row.frequency[best]) best = s;
  }
  return {
    sector: best,
    speedMph: row.speedMph[best] || row.medianMph,
    frequency: row.frequency[best],
    calmFraction: row.calmFraction,
  };
}

export type WindFeel = "calm" | "breezy" | "windy";

/**
 * Words for an estimated pedestrian-level speed.
 *
 * Bands follow the Beaufort-style ladder that comfort criteria are built on
 * (light air and gentle breeze are pleasant; a moderate breeze lifts dust
 * and papers; a fresh breeze makes walking and umbrellas awkward). They are
 * deliberately three coarse words, not miles per hour: the screening model
 * that produces the number is good for "this street is windier than that
 * one", and false precision here would be exactly the over-claiming the
 * rest of this project refuses to do.
 */
export function windFeel(speedMph: number): WindFeel {
  if (speedMph < 5) return "calm";
  if (speedMph < 12) return "breezy";
  return "windy";
}
