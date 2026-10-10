/**
 * Checking the wind model against what the crew measured.
 *
 * The crew's wind reading on a street is only meaningful against the wind
 * out in the open at the same moment — a 6 mph reading is "sheltered" on a
 * 20 mph day and "exposed" on a 7 mph one. So each reading is turned into a
 * RATIO: measured speed / Logan Airport's observed speed at that hour. The
 * model predicts exactly that kind of ratio for every sidewalk, so the two
 * are directly comparable.
 *
 * The test that matters is rank agreement. The model is a screening model
 * (see docs/wind-model.md): its claim is that one street is windier than
 * another, not that it knows the speed. So the headline is Spearman's rank
 * correlation between measured and modelled ratios across readings, and the
 * code refuses to give a verdict from too few readings.
 */
import { edgeLine, type WalkNetwork } from "./network";
import { SECTOR_COUNT, sectorOf } from "./wind";
import { makeProjection, type Metric } from "./urban-geometry";

export type FieldWindReading = {
  id: string;
  siteCode: string | null;
  recordedAt: string; // ISO
  lat: number;
  lng: number;
  windMph: number;
  windGustMph: number | null;
  /** Compass point the crew read the wind as coming FROM, if recorded. */
  windFrom: string | null;
};

/** One Logan Airport observation. */
export type LoganObservation = {
  time: string; // ISO
  mph: number;
  /** Degrees the wind blows FROM; null when calm or variable. */
  fromDeg: number | null;
};

export type WindWindowRatios = {
  /** ratios[sector][edge], percent of open-ground speed. */
  ratios: number[][];
};

export type ComparisonRow = {
  id: string;
  siteCode: string | null;
  edge: number;
  edgeDistanceM: number;
  loganMph: number;
  loganFromDeg: number;
  measuredMph: number;
  measuredRatio: number;
  /** Model ratio using Logan's wind direction — how the app really uses it. */
  modelRatio: number;
  /** Model ratio using the direction the crew wrote down, when they did. */
  modelRatioCrewDirection: number | null;
};

export type SkipReason =
  | "no-logan-observation"
  | "logan-calm"
  | "far-from-network"
  | "outside-network";

export type ComparisonResult = {
  rows: ComparisonRow[];
  skipped: Record<SkipReason, number>;
  n: number;
  /** Rank agreement, -1 to 1, or null when there are too few readings. */
  spearman: number | null;
  /** Median of measured/model: above 1 means the model runs calmer than the street. */
  medianBias: number | null;
  /** Mean absolute error of the ratio, in units of open-ground wind. */
  meanAbsError: number | null;
  verdict: "insufficient" | "disagrees" | "weak" | "agrees";
};

/** Fewer readings than this cannot say anything about rank agreement. */
export const MIN_READINGS_FOR_VERDICT = 15;

const CARDINAL_DEG: Record<string, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

/** Readings further than this from any sidewalk are not on the network. */
const MAX_EDGE_DISTANCE_M = 25;
/** A Logan observation must be this close in time to count. */
const MAX_OBS_GAP_MS = 45 * 60 * 1000;

function distanceToSegment(p: Metric, a: Metric, b: Metric): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The walkway edge nearest a point, by distance to its polyline. */
export function nearestEdge(
  network: WalkNetwork,
  point: [number, number],
): { edge: number; distanceM: number } | null {
  if (network.edges.length === 0) return null;
  const projection = makeProjection(point[1], point[0]);
  const p: Metric = [0, 0];
  let best = { edge: -1, distanceM: Number.POSITIVE_INFINITY };
  for (let i = 0; i < network.edges.length; i++) {
    const line = edgeLine(network, i, network.edges[i].a).map(([lng, lat]) =>
      projection.toMetric(lng, lat),
    );
    for (let k = 1; k < line.length; k++) {
      const d = distanceToSegment(p, line[k - 1], line[k]);
      if (d < best.distanceM) best = { edge: i, distanceM: d };
    }
  }
  return best.edge === -1 ? null : best;
}

function nearestObservation(time: number, observations: LoganObservation[]): LoganObservation | null {
  let best: LoganObservation | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const o of observations) {
    const gap = Math.abs(new Date(o.time).getTime() - time);
    if (gap < bestGap) {
      bestGap = gap;
      best = o;
    }
  }
  return best && bestGap <= MAX_OBS_GAP_MS ? best : null;
}

function rank(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  // Average ranks over ties so tied values do not manufacture a ranking.
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation, or null when it is undefined (a constant series). */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function compareWindToCrew(
  network: WalkNetwork,
  model: WindWindowRatios,
  readings: FieldWindReading[],
  observations: LoganObservation[],
): ComparisonResult {
  const skipped: Record<SkipReason, number> = {
    "no-logan-observation": 0,
    "logan-calm": 0,
    "far-from-network": 0,
    "outside-network": 0,
  };
  const rows: ComparisonRow[] = [];

  for (const reading of readings) {
    const obs = nearestObservation(new Date(reading.recordedAt).getTime(), observations);
    if (!obs) {
      skipped["no-logan-observation"]++;
      continue;
    }
    if (obs.fromDeg === null || obs.mph < 3) {
      skipped["logan-calm"]++;
      continue;
    }
    const near = nearestEdge(network, [reading.lng, reading.lat]);
    if (!near) {
      skipped["outside-network"]++;
      continue;
    }
    if (near.distanceM > MAX_EDGE_DISTANCE_M) {
      skipped["far-from-network"]++;
      continue;
    }

    const sector = sectorOf(obs.fromDeg);
    const crewSector =
      reading.windFrom && reading.windFrom in CARDINAL_DEG
        ? sectorOf(CARDINAL_DEG[reading.windFrom])
        : null;

    rows.push({
      id: reading.id,
      siteCode: reading.siteCode,
      edge: near.edge,
      edgeDistanceM: near.distanceM,
      loganMph: obs.mph,
      loganFromDeg: obs.fromDeg,
      measuredMph: reading.windMph,
      measuredRatio: reading.windMph / obs.mph,
      modelRatio: model.ratios[sector][near.edge] / 100,
      modelRatioCrewDirection:
        crewSector === null ? null : model.ratios[crewSector][near.edge] / 100,
    });
  }

  const n = rows.length;
  const rho = spearman(
    rows.map((r) => r.measuredRatio),
    rows.map((r) => r.modelRatio),
  );
  const verdict: ComparisonResult["verdict"] =
    n < MIN_READINGS_FOR_VERDICT || rho === null
      ? "insufficient"
      : rho >= 0.5
        ? "agrees"
        : rho >= 0.2
          ? "weak"
          : "disagrees";

  return {
    rows,
    skipped,
    n,
    spearman: rho,
    medianBias: n ? median(rows.map((r) => r.measuredRatio / Math.max(0.01, r.modelRatio))) : null,
    meanAbsError: n
      ? rows.reduce((s, r) => s + Math.abs(r.measuredRatio - r.modelRatio), 0) / n
      : null,
    verdict,
  };
}

export const SECTORS = SECTOR_COUNT;
