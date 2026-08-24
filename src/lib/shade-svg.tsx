import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

/**
 * Renders a shade slot as plain SVG.
 *
 * The print sheets deliberately do not use MapLibre: a WebGL canvas is
 * unreliable in a print stylesheet, needs JavaScript, and needs tiles. An
 * SVG projection of the same precomputed geometry prints identically
 * everywhere and works with the network off — which matters, because §0
 * says paper is the channel that actually reaches the residents this
 * project is for.
 */

export type Bbox = [number, number, number, number]; // [west, south, east, north]

/**
 * Web Mercator, restricted to the tiny extent of one Chinatown block. At
 * this scale a plate-carrée projection with a cos(lat) correction is
 * indistinguishable from a full Mercator and far simpler to reason about.
 */
function project(
  [lng, lat]: Position,
  bbox: Bbox,
  width: number,
  height: number,
): [number, number] {
  const [west, south, east, north] = bbox;
  const x = ((lng - west) / (east - west)) * width;
  // SVG y grows downward; latitude grows upward.
  const y = ((north - lat) / (north - south)) * height;
  return [x, y];
}

function ringToPath(ring: Position[], bbox: Bbox, w: number, h: number): string {
  return (
    ring
      .map((pos, i) => {
        const [x, y] = project(pos, bbox, w, h);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

function geometryToPath(geometry: Geometry, bbox: Bbox, w: number, h: number): string {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((r) => ringToPath(r, bbox, w, h)).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .flatMap((poly) => poly.map((r) => ringToPath(r, bbox, w, h)))
      .join(" ");
  }
  return "";
}

/** True when a feature has any coordinate inside the block extent. Keeps
 *  each sheet's SVG to the geometry it actually shows. */
function intersects(geometry: Geometry, bbox: Bbox): boolean {
  const [west, south, east, north] = bbox;
  const check = (pos: Position) =>
    pos[0] >= west && pos[0] <= east && pos[1] >= south && pos[1] <= north;
  const walk = (coords: unknown): boolean => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      return check(coords as Position);
    }
    return Array.isArray(coords) && coords.some(walk);
  };
  return walk((geometry as { coordinates?: unknown }).coordinates);
}

export function ShadeSvg({
  shade,
  buildings,
  bbox,
  width = 300,
  height = 300,
  label,
}: {
  shade: FeatureCollection;
  buildings: FeatureCollection;
  bbox: Bbox;
  width?: number;
  height?: number;
  label: string;
}) {
  const buildingShade = shade.features.find((f) => f.properties?.kind === "building");
  const treeShade = shade.features.find((f) => f.properties?.kind === "tree");

  const footprints = buildings.features.filter((f: Feature) =>
    intersects(f.geometry, bbox),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="h-auto w-full border border-neutral-400"
    >
      <rect width={width} height={height} fill="#ffffff" />

      {/* Building footprints give the block its shape on paper. */}
      {footprints.map((f, i) => (
        <path
          key={`b-${i}`}
          d={geometryToPath(f.geometry, bbox, width, height)}
          fill="#e7e5e4"
          stroke="#a8a29e"
          strokeWidth={0.4}
        />
      ))}

      {/* Tree shade under building shade, and lighter — §14. */}
      {treeShade ? (
        <path
          d={geometryToPath(treeShade.geometry, bbox, width, height)}
          fill="#4b5563"
          fillOpacity={0.3}
        />
      ) : null}
      {buildingShade ? (
        <path
          d={geometryToPath(buildingShade.geometry, bbox, width, height)}
          fill="#1f2937"
          fillOpacity={0.55}
        />
      ) : null}

      <rect
        width={width}
        height={height}
        fill="none"
        stroke="#404040"
        strokeWidth={1}
      />
    </svg>
  );
}
