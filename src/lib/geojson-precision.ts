import type { Geometry, Position } from "geojson";

/**
 * Six decimal places is about 11 cm at this latitude — far finer than a
 * shadow model that assumes flat ground and opaque tree crowns can justify.
 * Full float precision roughly triples the file size for no visible gain.
 */
export const COORD_PRECISION = 6;

function roundPosition(position: Position, precision: number): Position {
  const factor = 10 ** precision;
  return position.map((n) => Math.round(n * factor) / factor) as Position;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roundCoords(coords: any, precision: number): any {
  if (typeof coords[0] === "number") return roundPosition(coords as Position, precision);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (coords as any[]).map((c) => roundCoords(c, precision));
}

export function roundGeometry<T extends Geometry>(
  geometry: T,
  precision: number = COORD_PRECISION,
): T {
  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map((g) => roundGeometry(g, precision)),
    };
  }
  return { ...geometry, coordinates: roundCoords(geometry.coordinates, precision) };
}
