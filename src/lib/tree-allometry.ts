/**
 * Estimating tree crown size and height from trunk diameter.
 *
 * SPEC §6 assumes the tree layer carries a crown diameter field ("use the
 * diameter field where present"). It does not. The BPRD Trees layer's only
 * size attribute is `dbh` — trunk diameter at breast height, in inches,
 * stored as a string. There is no crown field and no height field anywhere
 * in that layer.
 *
 * So crown radius and height here are ESTIMATES derived from trunk
 * diameter, not measurements. The constants below are deliberately
 * conservative, clamped at both ends, and surfaced on /about so the
 * assumption is visible to anyone reading the map. Where a modelled shadow
 * disagrees with a field reading, the field reading is the ground truth
 * (§6).
 *
 * A better source exists and is worth doing later: Boston's Tree Canopy
 * Height Change 2014-2019 layer carries LiDAR-derived canopy polygons with
 * real heights. It is ~4.5M polygons citywide, so it needs a tiled bbox
 * extract, and it gives canopy area rather than per-tree crowns — a
 * different shape of input than the §6 algorithm takes.
 */

const INCHES_TO_METRES = 0.0254;

/** Open-grown urban trees carry a crown roughly 1.75x their DBH in feet per
 *  inch of trunk — i.e. a 16in oak spreads about 28ft. Mid-range rule of
 *  thumb; individual species vary widely. */
const CROWN_DIAMETER_FT_PER_DBH_INCH = 1.75;
const FEET_TO_METRES = 0.3048;

const MIN_CROWN_RADIUS_M = 1.5;
const MAX_CROWN_RADIUS_M = 12;

/** Fallbacks when dbh is missing, per SPEC §6. */
export const DEFAULT_CROWN_RADIUS_M = 4;
export const DEFAULT_TREE_HEIGHT_M = 8;

const MIN_TREE_HEIGHT_M = 4;
const MAX_TREE_HEIGHT_M = 18;
const HEIGHT_BASE_M = 4;
const HEIGHT_M_PER_DBH_INCH = 0.35;

/** BPRD stores dbh as a string like "16.00000000", and it is often null. */
export function parseDbhInches(raw: unknown): number | null {
  if (raw == null) return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function crownRadiusM(dbhInches: number | null): number {
  if (dbhInches == null) return DEFAULT_CROWN_RADIUS_M;
  const diameterM = dbhInches * CROWN_DIAMETER_FT_PER_DBH_INCH * FEET_TO_METRES;
  return clamp(diameterM / 2, MIN_CROWN_RADIUS_M, MAX_CROWN_RADIUS_M);
}

export function treeHeightM(dbhInches: number | null): number {
  if (dbhInches == null) return DEFAULT_TREE_HEIGHT_M;
  const height = HEIGHT_BASE_M + dbhInches * HEIGHT_M_PER_DBH_INCH;
  return clamp(height, MIN_TREE_HEIGHT_M, MAX_TREE_HEIGHT_M);
}

/** Trunk diameter itself, for reference. Not used for shadow casting. */
export function dbhMetres(dbhInches: number): number {
  return dbhInches * INCHES_TO_METRES;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
