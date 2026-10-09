/**
 * Checks the urban-geometry toolkit against shapes whose answers are known
 * by construction: a ray cast that is subtly wrong would not look wrong in
 * a wind map — it would just quietly put the windy streets in the wrong
 * places.
 *
 * Run with: npm run verify:wind
 */
import {
  ObstacleIndex,
  angleBetween,
  bearingBetween,
  bearingVector,
  makeObstacle,
  makeProjection,
  type Metric,
} from "../src/lib/urban-geometry";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** Axis-aligned box, [x0,y0]-[x1,y1] metres. */
function box(id: string, x0: number, y0: number, x1: number, y1: number, h: number) {
  const ring: Metric[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return makeObstacle(id, ring, h, false);
}

console.log("\nBearings and vectors");
{
  const [e, n] = bearingVector(90);
  check("bearing 90 points east", near(e, 1) && near(n, 0));
  const [e2, n2] = bearingVector(0);
  check("bearing 0 points north", near(e2, 0) && near(n2, 1));
  check("bearing from origin to east point is 90", near(bearingBetween([0, 0], [10, 0]), 90));
  check("bearing from origin to south point is 180", near(bearingBetween([0, 0], [0, -10]), 180));
  check("angle wraps across north (350 vs 10 = 20)", near(angleBetween(350, 10), 20));
  check("angle is symmetric", near(angleBetween(30, 200), angleBetween(200, 30)));
}

console.log("\nProjection");
{
  const p = makeProjection(42.3515, -71.0605);
  const [x, y] = p.toMetric(-71.0605, 42.3515);
  check("origin projects to (0, 0)", near(x, 0) && near(y, 0));
  const [, north] = p.toMetric(-71.0605, 42.3515 + 0.001);
  check("0.001 deg of latitude is ~111 m", near(north, 111.13, 0.5), `(got ${north.toFixed(2)})`);
  const [east] = p.toMetric(-71.0605 + 0.001, 42.3515);
  check("0.001 deg of longitude is ~82 m at 42 N", near(east, 82.3, 0.7), `(got ${east.toFixed(2)})`);
  const back = p.toLngLat(p.toMetric(-71.0612, 42.3498));
  check("projection round-trips", near(back[0], -71.0612, 1e-9) && near(back[1], 42.3498, 1e-9));
}

console.log("\nRay casting");
{
  const wall = box("wall", 20, -10, 30, 10, 25);
  const index = new ObstacleIndex([wall]);

  const east = index.castRay([0, 0], 90, 100);
  check("a ray east hits the wall's near face at 20 m", !!east && near(east.distance, 20), `(got ${east?.distance})`);
  check("the hit reports the wall's height", east?.obstacle.height === 25);

  check("a ray west finds nothing", index.castRay([0, 0], 270, 100) === null);
  check("a ray north passes beside the wall", index.castRay([0, 0], 0, 100) === null);
  check("range limit is respected", index.castRay([0, 0], 90, 15) === null);

  const diagonal = index.castRay([0, -30], 45, 100);
  check(
    "a diagonal ray from the south-west hits the south face",
    !!diagonal && near(diagonal.distance, 28.28, 0.05),
    `(got ${diagonal?.distance})`,
  );

  const near1 = box("near", 10, -5, 15, 5, 10);
  const far1 = box("far", 40, -5, 50, 5, 40);
  const both = new ObstacleIndex([far1, wall, near1]);
  const first = both.castRay([0, 0], 90, 100);
  check(
    "with several buildings in line the NEAREST is reported",
    first?.obstacle.id === "near" && near(first.distance, 10),
    `(got ${first?.obstacle.id} at ${first?.distance})`,
  );

  // Starting inside a footprint (misaligned source data) must not read as
  // "blocked at 0 m" by the building we are standing in.
  const inside = index.castRay([25, 0], 90, 100);
  check("a ray starting inside a building ignores that building", inside === null, `(got ${inside?.distance})`);
}

console.log("\nStreet width from rays");
{
  // A 12 m wide street running east-west between two long buildings.
  const south = box("south", -100, -30, 100, -6, 18);
  const north = box("north", -100, 6, 100, 30, 24);
  const index = new ObstacleIndex([south, north]);
  const left = index.castRay([0, 0], 0, 60);
  const right = index.castRay([0, 0], 180, 60);
  check("north facade is 6 m away", !!left && near(left.distance, 6));
  check("south facade is 6 m away", !!right && near(right.distance, 6));
  const width = (left?.distance ?? 0) + (right?.distance ?? 0);
  check("street width comes out as 12 m", near(width, 12));
  const meanH = ((left?.obstacle.height ?? 0) + (right?.obstacle.height ?? 0)) / 2;
  check("mean facade height is 21 m, so H/W is 1.75", near(meanH / width, 1.75));
}

console.log("\nNeighbourhood queries");
{
  const a = box("a", 0, 0, 10, 10, 10);
  const b = box("b", 200, 200, 210, 210, 10);
  const index = new ObstacleIndex([a, b]);
  check("within() finds the close building only", index.within([0, 0], 50).length === 1);
  check("within() with a big radius finds both", index.within([100, 100], 200).length === 2);
}

console.log(
  failures === 0
    ? "\nAll urban-geometry checks passed.\n"
    : `\n${failures} urban-geometry check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
