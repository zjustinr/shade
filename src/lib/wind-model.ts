/**
 * Street-level wind: a SCREENING model for how much a given wind is
 * accelerated or sheltered at a point on a sidewalk.
 *
 * What this is, and is not. It is a transparent, equation-based estimate
 * built from building footprints and heights alone, in the family of the
 * empirical methods consultants use for first-pass pedestrian wind comfort
 * (Gandemer-Guyot amplification coefficients; Reiter's urban velocity
 * ratios; shelter by obstruction angle). It is good for saying "this street
 * is windier than that one for a westerly wind". It is NOT a CFD result or a
 * wind-tunnel test, no published validation of an equation-only screening
 * model against downtown wind-tunnel data exists, and its output is a
 * RATIO to open-ground wind, never a measured speed. The app says so.
 *
 * What it ignores, and says it ignores: trees, awnings, street furniture,
 * terrain, thermal and rain effects, gust time-series, and anything wider
 * than a few hundred metres upwind.
 *
 * Wind direction is the meteorological "from" bearing (see wind.ts).
 */
import {
  ObstacleIndex,
  angleBetween,
  bearingVector,
  type Metric,
  type Obstacle,
} from "./urban-geometry";

/**
 * Pedestrian-level (1.5 m) speed as a fraction of the 10 m wind over open,
 * flat, low terrain: the logarithmic law with z0 = 0.03 m,
 * ln(1.5/0.03) / ln(10/0.03) = 3.91 / 5.81 = 0.67. (Derived, standard.)
 */
export const RATIO_OPEN = 0.67;

/**
 * The same ratio deep inside continuous urban fabric. Reiter (2010), from
 * the Santamouris/Davenport-Wieringa terrain fits: 0.39 for continuous
 * blocks and 0.24 for dense areas with tall buildings; 0.30 is the middle
 * of that range.
 */
export const RATIO_DENSE = 0.3;

/** Reiter's mean-speed ratios top out near 2.7 at double corners; Gandemer's
 *  tallest-tower corner factor is 2.2. Never claim more than this. */
export const RATIO_CAP = 2.2;

/** Footprints with no height in the source. They are mostly small
 *  outbuildings (median footprint 76 m2), but leaving them out would punch
 *  false open gaps in the streets. The sensitivity of the results to this
 *  guess is reported by scripts/build-wind.ts. */
export const ASSUMED_HEIGHT_M = 12;

/** Pedestrian height used for obstruction angles. */
const EYE_M = 1.5;

/** Gandemer: corner amplification vs building height. Interpolated between
 *  1.2 at ~15 m, 1.4 for 35-45 m towers, and 2.2 near 100 m. */
function cornerAmplification(heightM: number): number {
  const table: Array<[number, number]> = [
    [15, 1.2],
    [40, 1.4],
    [100, 2.2],
  ];
  if (heightM <= table[0][0]) return 1 + ((heightM - EYE_M) / (table[0][0] - EYE_M)) * 0.2;
  for (let i = 1; i < table.length; i++) {
    if (heightM <= table[i][0]) {
      const [h0, a0] = table[i - 1];
      const [h1, a1] = table[i];
      return a0 + ((heightM - h0) / (h1 - h0)) * (a1 - a0);
    }
  }
  return table[table.length - 1][1];
}

/** Gandemer: downwash at the base of a tall facade, 1.5 near 60 m. */
function downwashAmplification(heightM: number): number {
  return 1 + 0.5 * Math.min(1, Math.max(0, (heightM - 30) / 30));
}

export type WindContext = {
  index: ObstacleIndex;
};

const localMeanCache = new WeakMap<ObstacleIndex, Map<string, number>>();

/** Mean height of the buildings around one (excluding itself). */
function localMeanHeight(ctx: WindContext, t: Obstacle): number {
  let cache = localMeanCache.get(ctx.index);
  if (!cache) {
    cache = new Map();
    localMeanCache.set(ctx.index, cache);
  }
  const cached = cache.get(t.id);
  if (cached !== undefined) return cached;
  const neighbours = ctx.index.within(t.centre, 80).filter((o) => o.id !== t.id);
  const mean = neighbours.length
    ? neighbours.reduce((sum, o) => sum + o.height, 0) / neighbours.length
    : ASSUMED_HEIGHT_M;
  cache.set(t.id, mean);
  return mean;
}

export type PointWind = {
  /** Pedestrian-level speed as a ratio of the open-ground 10 m wind. */
  ratio: number;
  /** Diagnostics, for tests and for the build summary. */
  shelter: number;
  amplification: number;
  channel: number;
};

/** How strongly the obstruction ahead shelters a point: the elevation angle
 *  of the nearest obstacle on each upwind ray, saturating at 40 degrees. */
function shelterFromRays(
  ctx: WindContext,
  point: Metric,
  windFromDeg: number,
): { shelter: number; centreHit: { distance: number; obstacle: Obstacle } | null } {
  const offsets = [-20, -10, 0, 10, 20];
  let total = 0;
  let centreHit: { distance: number; obstacle: Obstacle } | null = null;
  for (const off of offsets) {
    const hit = ctx.index.castRay(point, windFromDeg + off, 250);
    if (off === 0) centreHit = hit;
    if (!hit) continue;
    const angle =
      (Math.atan2(Math.max(0, hit.obstacle.height - EYE_M), Math.max(1, hit.distance)) * 180) /
      Math.PI;
    total += Math.min(1, angle / 40);
  }
  return { shelter: total / offsets.length, centreHit };
}

/** Gandemer corner acceleration: near the windward corners of a building that
 *  stands well above its surroundings. */
function cornerFactor(ctx: WindContext, point: Metric, windFromDeg: number): number {
  const wind = bearingVector(windFromDeg); // points toward where the wind comes FROM
  const across: Metric = [-wind[1], wind[0]];
  let best = 1;

  for (const t of ctx.index.within(point, 70)) {
    if (t.height < 20) continue;
    // Tall relative to its neighbours, not merely tall in absolute terms.
    if (t.height < 1.5 * localMeanHeight(ctx, t)) continue;

    // The two windward corners: the lateral extremes among vertices on the
    // upwind half of the footprint.
    const upwind = t.ring.filter(
      (v) => (v[0] - t.centre[0]) * wind[0] + (v[1] - t.centre[1]) * wind[1] >= 0,
    );
    const candidates = upwind.length >= 2 ? upwind : t.ring;
    let left = candidates[0];
    let right = candidates[0];
    for (const v of candidates) {
      const lat = (v[0] - t.centre[0]) * across[0] + (v[1] - t.centre[1]) * across[1];
      const latL = (left[0] - t.centre[0]) * across[0] + (left[1] - t.centre[1]) * across[1];
      const latR = (right[0] - t.centre[0]) * across[0] + (right[1] - t.centre[1]) * across[1];
      if (lat < latL) left = v;
      if (lat > latR) right = v;
    }

    const reach = Math.min(40, Math.max(15, 0.5 * t.height));
    const d = Math.min(
      Math.hypot(point[0] - left[0], point[1] - left[1]),
      Math.hypot(point[0] - right[0], point[1] - right[1]),
    );
    if (d >= reach) continue;
    const peak = cornerAmplification(t.height);
    best = Math.max(best, 1 + (peak - 1) * (1 - d / reach));
  }
  return best;
}

/** Downwash: standing at the windward base of a tall facade. */
function downwashFactor(
  centreHit: { distance: number; obstacle: Obstacle } | null,
  ctx: WindContext,
): number {
  if (!centreHit) return 1;
  const t = centreHit.obstacle;
  if (t.height < 40) return 1;
  if (centreHit.distance > Math.min(30, 0.4 * t.height)) return 1;
  if (t.height < 1.5 * localMeanHeight(ctx, t)) return 1;
  return downwashAmplification(t.height);
}

/**
 * Enclosed-street channelling: wind blowing along a street between
 * buildings on both sides is squeezed. Gandemer's slot/venturi range is
 * 1.3 to 1.6; the lower end is used and scaled by how enclosed the street
 * is, because this is the least well-supported part of the model.
 */
function channelFactor(
  ctx: WindContext,
  point: Metric,
  streetBearingDeg: number,
  windFromDeg: number,
): number {
  const left = ctx.index.castRay(point, streetBearingDeg + 90, 40);
  const right = ctx.index.castRay(point, streetBearingDeg - 90, 40);
  if (!left || !right) return 1;
  const width = left.distance + right.distance;
  if (width > 30) return 1;
  const heightMean = (left.obstacle.height + right.obstacle.height) / 2;
  const aspect = heightMean / Math.max(width, 3);
  if (aspect < 0.5) return 1;

  // Angle between the wind's line of travel and the street axis (0-90).
  const axis = angleBetween(windFromDeg % 180, streetBearingDeg % 180);
  const off = Math.min(axis, 180 - axis);
  if (off > 30) return 1;
  return 1 + 0.3 * Math.min(1, aspect) * (1 - off / 30);
}

/**
 * The model for one point: pedestrian-level speed relative to open ground
 * for a wind from `windFromDeg`, at a point on a street running along
 * `streetBearingDeg`.
 */
export function windAtPoint(
  ctx: WindContext,
  point: Metric,
  streetBearingDeg: number,
  windFromDeg: number,
): PointWind {
  const { shelter, centreHit } = shelterFromRays(ctx, point, windFromDeg);
  const base = RATIO_OPEN - (RATIO_OPEN - RATIO_DENSE) * shelter;

  const amplification = Math.max(
    cornerFactor(ctx, point, windFromDeg),
    downwashFactor(centreHit, ctx),
  );
  const channel = channelFactor(ctx, point, streetBearingDeg, windFromDeg);

  const ratio = Math.min(RATIO_CAP, base * Math.max(amplification, channel));
  return { ratio, shelter, amplification, channel };
}
