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
  /** 0 = shortest walk, 1 = maximum shade. */
  shadeWeight: number;
  label: string;
};

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

function edgeCost(lengthM: number, exposurePercent: number, shadeWeight: number): number {
  const sun = exposurePercent / 100;
  return lengthM * (1 + shadeWeight * MAX_DETOUR_FACTOR * sun);
}

/** Dijkstra with an optional per-edge penalty multiplier, used to push later
 *  alternatives off the roads earlier ones already used. */
function shortestPath(
  network: WalkNetwork,
  exposure: number[],
  start: number,
  goal: number,
  shadeWeight: number,
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

      let cost = edgeCost(edge.len, exposure[edgeIndex] ?? 50, shadeWeight);
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
): Route {
  let distanceM = 0;
  let shadedM = 0;
  const line: [number, number][] = [];

  for (let i = 0; i < path.edges.length; i++) {
    const edgeIndex = path.edges[i];
    const edge = network.edges[edgeIndex];
    const fromNode = path.nodes[i];
    distanceM += edge.len;
    shadedM += edge.len * (1 - (exposure[edgeIndex] ?? 50) / 100);

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
    const candidate = describe(network, exposure, path, weight);
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
    consider(shortestPath(network, exposure, start, goal, weight, null), weight);
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
    consider(shortestPath(network, exposure, start, goal, weight, penalty), weight);
  }

  // Shadiest first — that is the reason someone opened this planner.
  routes.sort((a, b) => b.shadePercent - a.shadePercent);
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
