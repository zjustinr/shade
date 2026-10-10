/**
 * Wind units for the field form.
 *
 * Handheld anemometers report in different units depending on the model and
 * its settings. A crew member who types a m/s reading into an mph field
 * records a wind 2.2 times too weak, and nothing downstream could tell. So
 * the form asks for the unit and converts once, here, and only mph is ever
 * stored.
 */

export const WIND_UNITS = ["mph", "ms", "kmh", "knots"] as const;
export type WindUnit = (typeof WIND_UNITS)[number];

/** Miles per hour per one of each unit. */
const TO_MPH: Record<WindUnit, number> = {
  mph: 1,
  ms: 2.236936,
  kmh: 0.621371,
  knots: 1.150779,
};

export const WIND_UNIT_LABELS: Record<WindUnit, string> = {
  mph: "mph",
  ms: "m/s",
  kmh: "km/h",
  knots: "knots",
};

export function toMph(value: number, unit: WindUnit): number {
  return value * TO_MPH[unit];
}

/** One decimal place, which is all a handheld anemometer honestly resolves. */
export function roundMph(mph: number): number {
  return Math.round(mph * 10) / 10;
}

/** A wind speed above this on a Boston sidewalk deserves a second look. */
export const WIND_SANITY_WARN_MPH = 40;
