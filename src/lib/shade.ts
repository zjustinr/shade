import { getPosition } from "suncalc";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Point } from "geojson";

/**
 * 2D flat-ground shadow projection (SPEC §6).
 *
 * This is deliberately the honest, simple version. It models buildings as
 * extruded footprints and trees as opaque spheres on sticks, on flat ground.
 * It does NOT model terrain slope, awnings, scaffolding, overhangs, bus
 * shelters, or partial canopy transmissivity. Do not present its output as
 * measured fact — see the disclaimer requirement in §6.
 */

export const DEFAULT_TREE_HEIGHT_M = 8;
export const DEFAULT_CROWN_RADIUS_M = 4;

/** Longest shadow we'll draw. Below a few degrees of altitude, L = h/tan(alt)
 *  explodes toward infinity and the result is both useless and slow to union. */
const MAX_SHADOW_LENGTH_M = 500;

/**
 * Angles in DEGREES.
 *
 * Note a deviation from SPEC §6, which describes SunCalc's old v1.x API
 * (altitude in radians, azimuth in radians measured from south). suncalc
 * 2.x returns altitude in degrees above the horizon and azimuth in degrees
 * clockwise from north (0 = N, 90 = E, 180 = S, 270 = W). The physics is
 * unchanged; only the units and the azimuth reference direction differ.
 */
export type SunPosition = { altitudeDeg: number; azimuthDeg: number };

export function getSunPosition(date: Date, lat: number, lng: number): SunPosition {
  const { altitude, azimuth } = getPosition(date, lat, lng);
  return { altitudeDeg: altitude, azimuthDeg: azimuth };
}

/**
 * Shadow length for an object of height h at a given solar altitude.
 * Returns null when the sun is at or below the horizon.
 */
export function shadowLength(heightM: number, altitudeDeg: number): number | null {
  if (altitudeDeg <= 0) return null;
  const length = heightM / Math.tan((altitudeDeg * Math.PI) / 180);
  if (!Number.isFinite(length) || length < 0) return null;
  return Math.min(length, MAX_SHADOW_LENGTH_M);
}

/**
 * Compass bearing (degrees, 0 = north, clockwise) that shadows point along.
 * The sun's azimuth is already a bearing from north, and a shadow falls
 * directly away from the sun — hence the half turn.
 */
export function antiSolarBearing(azimuthDeg: number): number {
  return (azimuthDeg + 180) % 360;
}

/** Cast shadow for one building footprint: footprint ∪ translated footprint,
 *  convex-hulled so the swept volume between them is filled in. */
export function buildingShadow(
  footprint: Feature<Polygon | MultiPolygon>,
  heightM: number,
  sun: SunPosition,
): Feature<Polygon> | null {
  const length = shadowLength(heightM, sun.altitudeDeg);
  if (length == null || length === 0) return null;

  const bearing = antiSolarBearing(sun.azimuthDeg);
  const translated = turf.transformTranslate(
    turf.clone(footprint),
    length / 1000, // turf works in kilometres by default
    bearing,
    { units: "kilometers" },
  );

  const points = [
    ...turf.coordAll(footprint).map((c) => turf.point(c)),
    ...turf.coordAll(translated).map((c) => turf.point(c)),
  ];
  const hull = turf.convex(turf.featureCollection(points));
  return hull ?? null;
}

/** Cast shadow for one tree: a capsule from the crown circle to its
 *  translated copy. Opaque circles overstate dense shade — §6 and §14. */
export function treeShadow(
  tree: Feature<Point>,
  heightM: number,
  crownRadiusM: number,
  sun: SunPosition,
): Feature<Polygon> | null {
  const length = shadowLength(heightM, sun.altitudeDeg);
  if (length == null || length === 0) return null;

  const bearing = antiSolarBearing(sun.azimuthDeg);
  const radiusKm = crownRadiusM / 1000;
  const origin = turf.circle(tree, radiusKm, { steps: 16, units: "kilometers" });
  const moved = turf.circle(
    turf.transformTranslate(turf.clone(tree), length / 1000, bearing, { units: "kilometers" }),
    radiusKm,
    { steps: 16, units: "kilometers" },
  );

  const points = [
    ...turf.coordAll(origin).map((c) => turf.point(c)),
    ...turf.coordAll(moved).map((c) => turf.point(c)),
  ];
  const hull = turf.convex(turf.featureCollection(points));
  return hull ?? null;
}

/** Unions a set of shadow polygons into one MultiPolygon. Returns null when
 *  there is nothing to draw. */
export function unionShadows(
  shadows: Feature<Polygon>[],
): Feature<Polygon | MultiPolygon> | null {
  if (shadows.length === 0) return null;
  if (shadows.length === 1) return shadows[0];
  try {
    return turf.union(turf.featureCollection(shadows));
  } catch {
    // A malformed input polygon can make the union fail outright. Losing the
    // whole layer would be worse than losing the overlap merge, so fall back
    // to the unmerged set rather than returning nothing.
    return turf.combine(turf.featureCollection(shadows))
      .features[0] as Feature<MultiPolygon>;
  }
}

export type ShadeInputs = {
  buildings: FeatureCollection<Polygon | MultiPolygon>;
  trees: FeatureCollection<Point>;
  /** Attribute on each building feature holding its height in metres. */
  buildingHeightProperty: string;
  /** Attribute on each tree holding crown RADIUS in metres. Falls back to
   *  DEFAULT_CROWN_RADIUS_M where absent. */
  treeCrownRadiusProperty?: string;
  /** Attribute on each tree holding height in metres. Falls back to
   *  DEFAULT_TREE_HEIGHT_M where absent. */
  treeHeightProperty?: string;
};

export type ShadeResult = {
  buildingShade: Feature<Polygon | MultiPolygon> | null;
  treeShade: Feature<Polygon | MultiPolygon> | null;
  sun: SunPosition;
  /** Buildings skipped for want of a usable height — surfaced on /about (§14). */
  skippedBuildings: number;
  belowHorizon: boolean;
};

function numericProperty(
  feature: Feature,
  property: string | undefined,
  fallback: number,
): number {
  if (!property) return fallback;
  const value = Number(feature.properties?.[property]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Builds the two shadow layers for one instant. Building and tree shade are
 * returned separately so the map can render tree shadows at a lighter opacity
 * (§14: trees are over-modelled as opaque circles and should look less certain).
 */
export function computeShade(
  inputs: ShadeInputs,
  date: Date,
  centre: { lat: number; lng: number },
): ShadeResult {
  const sun = getSunPosition(date, centre.lat, centre.lng);

  // §6 step 2: below the horizon, everything is in shade. Return early.
  if (sun.altitudeDeg <= 0) {
    return {
      buildingShade: null,
      treeShade: null,
      sun,
      skippedBuildings: 0,
      belowHorizon: true,
    };
  }

  let skippedBuildings = 0;
  const buildingShadows: Feature<Polygon>[] = [];
  for (const feature of inputs.buildings.features) {
    const height = Number(feature.properties?.[inputs.buildingHeightProperty]);
    // §14: skip buildings with no height rather than guessing tall.
    if (!Number.isFinite(height) || height <= 0) {
      skippedBuildings += 1;
      continue;
    }
    const shadow = buildingShadow(feature, height, sun);
    if (shadow) buildingShadows.push(shadow);
  }

  const treeShadows: Feature<Polygon>[] = [];
  for (const feature of inputs.trees.features) {
    const crownRadius = numericProperty(
      feature,
      inputs.treeCrownRadiusProperty,
      DEFAULT_CROWN_RADIUS_M,
    );
    const height = numericProperty(feature, inputs.treeHeightProperty, DEFAULT_TREE_HEIGHT_M);
    const shadow = treeShadow(feature, height, crownRadius, sun);
    if (shadow) treeShadows.push(shadow);
  }

  return {
    buildingShade: unionShadows(buildingShadows),
    treeShade: unionShadows(treeShadows),
    sun,
    skippedBuildings,
    belowHorizon: false,
  };
}
