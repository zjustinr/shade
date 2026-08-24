/**
 * The pedestrian network the route planner walks over.
 *
 * Built at build time by scripts/build-network.ts from City street
 * centrelines clipped to the Chinatown bbox, and shipped as a static file —
 * same rule as the shade layer (§5): no City API is called at request time,
 * and the whole thing works from cache with no signal.
 */

export type NetworkNode = {
  /** [lng, lat] */
  c: [number, number];
};

export type NetworkEdge = {
  /** node index */
  a: number;
  /** node index */
  b: number;
  /** metres */
  len: number;
  /** street name, for turn-by-turn text */
  name: string | null;
  /** intermediate geometry between a and b, [lng, lat][] — excludes endpoints */
  geom: [number, number][];
};

export type WalkNetwork = {
  generatedAt: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** adjacency: node index -> [edgeIndex, ...] */
  adj: number[][];
};

/**
 * Sun exposure per edge, per half-hour slot, for one representative date.
 * Values are 0-100 (percent of the edge NOT in modelled shade), stored as
 * small integers because a float per edge per slot is mostly noise at this
 * model's accuracy and triples the transfer size.
 */
export type ExposureByDate = {
  dateKey: string;
  /** slot time "HH:MM" -> exposure percent per edge, indexed like edges */
  slots: Record<string, number[]>;
};

const EARTH_RADIUS_M = 6371000;

export function metresBetween(
  [lng1, lat1]: [number, number],
  [lng2, lat2]: [number, number],
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Full polyline of an edge, endpoints included, in walk order a -> b. */
export function edgeLine(
  network: WalkNetwork,
  edgeIndex: number,
  fromNode: number,
): [number, number][] {
  const edge = network.edges[edgeIndex];
  const line: [number, number][] = [
    network.nodes[edge.a].c,
    ...edge.geom,
    network.nodes[edge.b].c,
  ];
  return fromNode === edge.a ? line : [...line].reverse();
}

/** Nearest network node to a clicked point. */
export function nearestNode(network: WalkNetwork, point: [number, number]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < network.nodes.length; i++) {
    const d = metresBetween(network.nodes[i].c, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}
