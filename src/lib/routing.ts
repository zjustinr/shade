import {
  edgeLine,
  metresBetween,
  type WalkNetwork,
} from "./network";

/**
 * Shaded-route planning (SPEC §2 v2: "Shaded-route suggestion between two
 * points").
 *
 * Runs entirely in the browser over the precomputed network and per-edge
 * shade exposure. No routing service, no geocoder, no request carrying a
 * user's origin or destination off-origin — §10 Privacy allows no
 * third-party that "sends user data off-origin", and where someone is
 * walking from and to is exactly that kind of data.
 */

/** Average walking pace. On the slow side on purpose: the people this map is
 *  for are disproportionately over 60 (§0), and a route that promises a pace
 *  they cannot keep in the heat is worse than no route. */
export const WALK_METRES_PER_SECOND = 1.1;

export type RoutePreference = {
  /** 0 = shortest walk, 1 = maximum shade (or sun, per the seek target). */
  shadeWeight: number;
  label: string;
};

/**
 * What the walker is trying to stay in. Summer walking means seeking shade;
 * in winter the same streets and the same precomputed exposure answer the
 * opposite question — the warmest walk is the sunniest one.
 */
export type SeekTarget = "shade" | "sun";

/**
 * Optional wind preference. `mph` is the estimated pedestrian-level wind
 * speed on each edge (indexed like network.edges) for the wind the user
 * chose; `seek` says whether they want it calmer or breezier. The speeds
 * come from a screening model, so the router only ever uses them to rank
 * streets against each other — never as an absolute promise.
 */
export type WindPreference = {
  mph: number[];
  seek: "calm" | "breeze";
  /** 0 = ignore wind, 1 = as important as the shade/sun term at full weight. */
  weight: number;
  /**
   * The speed at which an edge counts as "as windy as it gets today".
   * Defaults to 12 mph. Callers pass the day's own windy end (see
   * windyEndMph) so that on a 25 mph day a 13 mph street and a 27 mph one
   * are still told apart instead of both saturating the scale.
   */
  fullMph?: number;
};

/** The day's "windy end": the 95th percentile of its edge speeds, but never
 *  below 8 mph, so a near-calm day does not blow 1 mph differences up into
 *  detours. */
export function windyEndMph(mph: number[]): number {
  if (mph.length === 0) return 12;
  const sorted = [...mph].sort((a, b) => a - b);
  return Math.max(8, sorted[Math.floor(0.95 * (sorted.length - 1))]);
}

/**
 * How unwelcome the wind on one edge is, 0 (fine) to 1 (as bad as it gets).
 *
 * Calmer is CONVEX on purpose. Walkers do not mind 5 mph against 6 mph; they
 * mind the corner where it is 13. A linear cost spends its effort on tiny
 * differences between already-calm streets and barely moves the route
 * (measured: it cut the average wind on the chosen route by 0.05 mph),
 * whereas squaring ignores small differences and strongly avoids the
 * extremes — which is the thing people actually describe ("some streets are
 * extremely windy"). Zero at 2 mph and below, one at the day's windy end (default 12 mph).
 *
 * Breezier is linear: a summer breeze helps in proportion, up to about
 * 10 mph.
 */
export function windDiscomfort(
  mph: number,
  seek: WindPreference["seek"],
  fullMph = 12,
): number {
  if (seek === "calm") {
    const x = Math.min(1, Math.max(0, (mph - 2) / Math.max(1, fullMph - 2)));
    return x * x;
  }
  return 1 - Math.min(1, Math.max(0, mph / 10));
}

export type Route = {
  /** Node indices along the route, in order. */
  nodes: number[];
  /** Edge indices along the route, in order. */
  edges: number[];
  /** Drawable polyline. */
  line: [number, number][];
  distanceM: number;
  seconds: number;
  /** 0-100, share of the walk in modelled shade. */
  shadePercent: number;
  shadeWeight: number;
  /** Distance-weighted mean estimated wind speed, or null with no wind data. */
  meanWindMph: number | null;
  /** Worst single stretch (>= 30 m) of the walk, or null with no wind data. */
  peakWindMph: number | null;
  /** Distance-weighted wind discomfort for the chosen seek, 0-1, or null. */
  windScore: number | null;
};

/**
 * Cost of traversing an edge under a given shade preference.
 *
 * At shadeWeight 0 this is plain distance. As the weight rises, walking in
 * the sun costs progressively more, so the search will accept a longer route
 * to stay in shadow. MAX_DETOUR_FACTOR caps how much: at full preference a
 * fully sunlit metre costs three shaded metres, which in practice buys
 * meaningful detours without producing absurd loops around a block.
 */
const MAX_DETOUR_FACTOR = 2;

function edgeCost(
  lengthM: number,
  exposurePercent: number,
  weight: number,
  seek: SeekTarget,
  windMph: number | null,
  wind: WindPreference | null,
): number {
  const sun = exposurePercent / 100;
  // The "discomfort" being avoided: sun when seeking shade, shade when
  // seeking winter sun. Same search either way.
  const discomfort = seek === "shade" ? sun : 1 - sun;
  let extra = weight * MAX_DETOUR_FACTOR * discomfort;

  if (wind && windMph !== null && wind.weight > 0) {
    extra += wind.weight * MAX_DETOUR_FACTOR * windDiscomfort(windMph, wind.seek, wind.fullMph);
  }
  return lengthM * (1 + extra);
}

/** Dijkstra with an optional per-edge penalty multiplier, used to push later
 *  alternatives off the roads earlier ones already used. */
function shortestPath(
  network: WalkNetwork,
  exposure: number[],
  start: number,
  goal: number,
  shadeWeight: number,
  seek: SeekTarget,
  wind: WindPreference | null,
  penalty: Float64Array | null,
): { nodes: number[]; edges: number[] } | null {
  const nodeCount = network.nodes.length;
  const dist = new Float64Array(nodeCount).fill(Number.POSITIVE_INFINITY);
  const prevNode = new Int32Array(nodeCount).fill(-1);
  const prevEdge = new Int32Array(nodeCount).fill(-1);
  const settled = new Uint8Array(nodeCount);

  dist[start] = 0;
  const queue = new MinHeap();
  queue.push(start, 0);

  while (queue.size > 0) {
    const current = queue.pop();
    if (current === -1) break;
    if (settled[current]) continue;
    settled[current] = 1;
    if (current === goal) break;

    for (const edgeIndex of network.adj[current]) {
      const edge = network.edges[edgeIndex];
      const next = edge.a === current ? edge.b : edge.a;
      if (settled[next]) continue;

      let cost = edgeCost(
        edge.len,
        exposure[edgeIndex] ?? 50,
        shadeWeight,
        seek,
        wind ? (wind.mph[edgeIndex] ?? null) : null,
        wind,
      );
      if (penalty) cost *= penalty[edgeIndex];

      const candidate = dist[current] + cost;
      if (candidate < dist[next]) {
        dist[next] = candidate;
        prevNode[next] = current;
        prevEdge[next] = edgeIndex;
        queue.push(next, candidate);
      }
    }
  }

  if (!Number.isFinite(dist[goal])) return null;

  const nodes: number[] = [];
  const edges: number[] = [];
  let cursor = goal;
  while (cursor !== -1) {
    nodes.push(cursor);
    if (prevEdge[cursor] !== -1) edges.push(prevEdge[cursor]);
    if (cursor === start) break;
    cursor = prevNode[cursor];
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges };
}

function describe(
  network: WalkNetwork,
  exposure: number[],
  path: { nodes: number[]; edges: number[] },
  shadeWeight: number,
  wind: WindPreference | null,
): Route {
  const windMph = wind ? wind.mph : null;
  let distanceM = 0;
  let shadedM = 0;
  let windWeighted = 0;
  let windScoreWeighted = 0;
  let peakWind = 0;
  const line: [number, number][] = [];

  for (let i = 0; i < path.edges.length; i++) {
    const edgeIndex = path.edges[i];
    const edge = network.edges[edgeIndex];
    const fromNode = path.nodes[i];
    distanceM += edge.len;
    shadedM += edge.len * (1 - (exposure[edgeIndex] ?? 50) / 100);
    if (windMph) {
      const w = windMph[edgeIndex] ?? 0;
      windWeighted += edge.len * w;
      windScoreWeighted += edge.len * windDiscomfort(w, wind!.seek, wind!.fullMph);
      // A 3 m sliver at a corner is not "the windy part of the walk".
      if (edge.len >= 30 && w > peakWind) peakWind = w;
    }

    const segment = edgeLine(network, edgeIndex, fromNode);
    // Skip the first point of every segment after the first: it duplicates
    // the previous segment's last point.
    line.push(...(i === 0 ? segment : segment.slice(1)));
  }

  return {
    nodes: path.nodes,
    edges: path.edges,
    line,
    distanceM,
    seconds: distanceM / WALK_METRES_PER_SECOND,
    shadePercent: distanceM > 0 ? (shadedM / distanceM) * 100 : 0,
    shadeWeight,
    meanWindMph: windMph && distanceM > 0 ? windWeighted / distanceM : null,
    peakWindMph: windMph ? peakWind : null,
    windScore: windMph && distanceM > 0 ? windScoreWeighted / distanceM : null,
  };
}

/** How much of one route's distance runs along edges another route also uses. */
function overlapFraction(a: Route, b: Route, network: WalkNetwork): number {
  const bEdges = new Set(b.edges);
  let shared = 0;
  for (const edgeIndex of a.edges) {
    if (bEdges.has(edgeIndex)) shared += network.edges[edgeIndex].len;
  }
  return a.distanceM > 0 ? shared / a.distanceM : 0;
}

/**
 * Three or more routes spanning the preference range, from the shadiest
 * walk to the shortest one.
 *
 * Sweeping the shade weight is what makes the alternatives *mean* something:
 * each route is genuinely optimal for one preference, so the user is picking
 * a trade-off rather than being handed arbitrary detours. Where two weights
 * happen to produce the same road, a penalised re-run finds a distinct
 * option so the promise of "at least 3 routes" still holds on a small grid.
 */
const MAX_OVERLAP = 0.9;

export function planRoutes(
  network: WalkNetwork,
  exposure: number[],
  start: number,
  goal: number,
  weights: number[] = [1, 0.5, 0],
  minimumRoutes = 3,
  seek: SeekTarget = "shade",
  wind: WindPreference | null = null,
): Route[] {
  if (start === goal) return [];

  const routes: Route[] = [];

  /**
   * Accept a candidate only if it is a materially different walk from every
   * route already held. Filtering here rather than at the end matters: a
   * post-hoc filter can drop the list back below the minimum after the
   * search has stopped looking, which is how "at least 3 routes" quietly
   * became two.
   */
  const consider = (path: { nodes: number[]; edges: number[] } | null, weight: number) => {
    if (!path || path.edges.length === 0) return false;
    const candidate = describe(network, exposure, path, weight, wind);
    const distinct = routes.every(
      (existing) =>
        overlapFraction(candidate, existing, network) < MAX_OVERLAP &&
        overlapFraction(existing, candidate, network) < MAX_OVERLAP,
    );
    if (!distinct) return false;
    routes.push(candidate);
    return true;
  };

  for (const weight of weights) {
    consider(shortestPath(network, exposure, start, goal, weight, seek, wind, null), weight);
  }

  // Still short of the promised count: re-run with the roads already used
  // made progressively more expensive, so the search is pushed onto a
  // genuinely different way round. The penalty escalates every attempt —
  // holding it fixed just reproduces the same path forever.
  for (let attempt = 1; routes.length < minimumRoutes && attempt <= 8; attempt++) {
    const penalty = new Float64Array(network.edges.length).fill(1);
    for (const route of routes) {
      for (const edgeIndex of route.edges) penalty[edgeIndex] *= 1 + 0.5 * attempt;
    }
    // Vary the preference too, so alternatives differ in character and not
    // only in which streets they avoid.
    const weight = weights[attempt % weights.length] ?? 0.5;
    consider(shortestPath(network, exposure, start, goal, weight, seek, wind, penalty), weight);
  }

  // Best-first for what was asked: shadiest in summer, sunniest in winter —
  // that is the reason someone opened this planner. With a wind preference
  // the ranking blends both comforts, so a slightly shadier route that
  // runs the length of a wind tunnel does not sit above a calmer one.
  const discomfort = (r: Route): number => {
    const sun = seek === "shade" ? 1 - r.shadePercent / 100 : r.shadePercent / 100;
    if (!wind || wind.weight <= 0 || r.windScore === null) return sun;
    return (sun + wind.weight * r.windScore) / (1 + wind.weight);
  };
  routes.sort((a, b) => discomfort(a) - discomfort(b));
  return routes;
}

/** Straight-line fallback used when the two points are not connected. */
export function directDistanceM(
  network: WalkNetwork,
  start: number,
  goal: number,
): number {
  return metresBetween(network.nodes[start].c, network.nodes[goal].c);
}

/** Binary min-heap keyed by cost. */
class MinHeap {
  private items: number[] = [];
  private costs: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, cost: number) {
    this.items.push(item);
    this.costs.push(cost);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number {
    if (this.items.length === 0) return -1;
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.costs[left] < this.costs[smallest]) smallest = left;
        if (right < this.items.length && this.costs[right] < this.costs[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
  }
}
