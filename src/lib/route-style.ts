import { metresBetween } from "./network";

/**
 * One colour per suggested route, shared by the line on the map, the
 * numbered badge sitting on that line, and the route's card in the planner.
 * The colour is the identity: "which line is Route 2" is answered by
 * matching the card's badge to the badge on the map, not by guessing.
 *
 * Chosen to stay apart from every other mark on this map: the shade fills
 * (grey/green), the reading dots (yellow-orange-red ramp), the start/end
 * markers (green/red), and the destination category dots.
 */
export const ROUTE_COLOURS = [
  "#2563eb", // blue
  "#c026d3", // magenta
  "#0d9488", // teal
  "#b45309", // brown
  "#65a30d", // olive
] as const;

export function routeColour(index: number): string {
  return ROUTE_COLOURS[index % ROUTE_COLOURS.length];
}

/**
 * Point a given fraction of the way along a polyline, by distance walked
 * rather than by vertex count — vertices cluster at corners, and a badge
 * placed by vertex index would pile up at whichever end has the detail.
 */
export function pointAlong(
  line: [number, number][],
  fraction: number,
): [number, number] {
  if (line.length === 0) return [0, 0];
  if (line.length === 1) return line[0];

  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += metresBetween(line[i - 1], line[i]);
    cumulative.push(total);
  }
  if (total === 0) return line[0];

  const target = total * Math.min(Math.max(fraction, 0), 1);
  for (let i = 1; i < line.length; i++) {
    if (cumulative[i] >= target) {
      const segment = cumulative[i] - cumulative[i - 1];
      const t = segment === 0 ? 0 : (target - cumulative[i - 1]) / segment;
      return [
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
      ];
    }
  }
  return line[line.length - 1];
}

/**
 * Badge positions are staggered along each route (35%, 53%, 71%, …) so that
 * where routes share their first and last blocks — which they usually do —
 * the numbers land on different stretches instead of on top of each other.
 */
export function badgeFraction(index: number): number {
  return Math.min(0.35 + index * 0.18, 0.85);
}
