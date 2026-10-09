/**
 * Geometry for the street-level wind model: buildings as obstacles in a
 * local metric frame, and ray casts against them.
 *
 * Everything the wind model needs to know about a street comes from asking
 * "what is in this direction, how far, and how tall" — how wide is the
 * street (rays to either side), what shelters it from a given wind (rays
 * upwind), whether a tall building stands at the corner (rays plus heights).
 */

export type Metric = [number, number]; // [x east, y north] in metres

export type Obstacle = {
  id: string;
  /** Roof height above ground, metres. */
  height: number;
  /** True when the height was assumed because the source had none. */
  assumedHeight: boolean;
  /** Outer ring in the local metric frame. */
  ring: Metric[];
  bbox: [number, number, number, number];
  centre: Metric;
};

export type RayHit = {
  distance: number;
  obstacle: Obstacle;
};

/** Local equirectangular projection around the study area. Over ~1 km the
 *  error against a true projection is well under a metre, far below the
 *  accuracy of the wind model it feeds. */
export function makeProjection(lat0: number, lng0: number) {
  const metresPerDegLat = 111_132;
  const metresPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toMetric(lng: number, lat: number): Metric {
      return [(lng - lng0) * metresPerDegLng, (lat - lat0) * metresPerDegLat];
    },
    toLngLat([x, y]: Metric): [number, number] {
      return [lng0 + x / metresPerDegLng, lat0 + y / metresPerDegLat];
    },
  };
}

/** Compass bearing (degrees clockwise from north) to a unit vector (east, north). */
export function bearingVector(bearingDeg: number): Metric {
  const rad = (bearingDeg * Math.PI) / 180;
  return [Math.sin(rad), Math.cos(rad)];
}

/** Compass bearing of the vector from a to b. */
export function bearingBetween(a: Metric, b: Metric): number {
  const deg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Smallest angle between two bearings, 0-180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function pointInRing(p: Metric, ring: Metric[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance along a ray (origin + t*dir, t >= 0) to the segment ab, or null. */
function raySegment(o: Metric, d: Metric, a: Metric, b: Metric): number | null {
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const denom = d[0] * sy - d[1] * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const ox = a[0] - o[0];
  const oy = a[1] - o[1];
  const t = (ox * sy - oy * sx) / denom;
  const u = (ox * d[1] - oy * d[0]) / denom;
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}

export class ObstacleIndex {
  readonly obstacles: Obstacle[];
  private cells = new Map<string, number[]>();
  private readonly cell = 40;

  constructor(obstacles: Obstacle[]) {
    this.obstacles = obstacles;
    obstacles.forEach((o, i) => {
      for (let cx = Math.floor(o.bbox[0] / this.cell); cx <= Math.floor(o.bbox[2] / this.cell); cx++) {
        for (let cy = Math.floor(o.bbox[1] / this.cell); cy <= Math.floor(o.bbox[3] / this.cell); cy++) {
          const key = `${cx}:${cy}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(i);
          else this.cells.set(key, [i]);
        }
      }
    });
  }

  /**
   * First obstacle hit by a ray, or null within maxDistance. A ray that
   * starts inside a footprint ignores that building: source data is not
   * perfectly aligned with the sidewalk network, and a sidewalk point that
   * lands a metre inside a facade must not read as "blocked immediately".
   */
  castRay(origin: Metric, bearingDeg: number, maxDistance: number): RayHit | null {
    const dir = bearingVector(bearingDeg);
    const seen = new Set<number>();
    let best: RayHit | null = null;

    for (let t = 0; t <= maxDistance + this.cell; t += this.cell / 2) {
      const px = origin[0] + dir[0] * Math.min(t, maxDistance);
      const py = origin[1] + dir[1] * Math.min(t, maxDistance);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${Math.floor(px / this.cell) + dx}:${Math.floor(py / this.cell) + dy}`;
          for (const index of this.cells.get(key) ?? []) {
            if (seen.has(index)) continue;
            seen.add(index);
            const o = this.obstacles[index];
            if (pointInRing(origin, o.ring)) continue;
            for (let i = 0; i < o.ring.length; i++) {
              const hit = raySegment(origin, dir, o.ring[i], o.ring[(i + 1) % o.ring.length]);
              if (hit !== null && hit <= maxDistance && (!best || hit < best.distance)) {
                best = { distance: hit, obstacle: o };
              }
            }
          }
        }
      }
    }
    return best;
  }

  /** Obstacles whose centre lies within a radius of a point. */
  within(point: Metric, radius: number): Obstacle[] {
    const out: Obstacle[] = [];
    const r = Math.ceil(radius / this.cell) + 1;
    const cx = Math.floor(point[0] / this.cell);
    const cy = Math.floor(point[1] / this.cell);
    const seen = new Set<number>();
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const index of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const o = this.obstacles[index];
          if (Math.hypot(o.centre[0] - point[0], o.centre[1] - point[1]) <= radius) out.push(o);
        }
      }
    }
    return out;
  }
}

export function makeObstacle(
  id: string,
  ring: Metric[],
  height: number,
  assumedHeight: boolean,
): Obstacle {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    cx += x;
    cy += y;
  }
  return {
    id,
    height,
    assumedHeight,
    ring,
    bbox: [minX, minY, maxX, maxY],
    centre: [cx / ring.length, cy / ring.length],
  };
}
