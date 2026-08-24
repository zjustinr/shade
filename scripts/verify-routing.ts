/**
 * Checks the route planner against a synthetic grid where the right answer
 * is known by construction.
 *
 * A routing bug does not look like a bug on a map — it looks like a slightly
 * odd line that a reader assumes is correct. So these assert the properties
 * that must hold: shortest-preference really is shortest, shade-preference
 * really is shadier, the detour is bounded, and the alternatives are
 * genuinely different roads.
 *
 * Run with: npm run verify:routing
 */
import { metresBetween, type WalkNetwork } from "../src/lib/network";
import { planRoutes } from "../src/lib/routing";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures += 1;
}

/**
 * An n x n lattice around Chinatown, ~80 m per block.
 * Node index = row * n + col.
 */
function buildGrid(n: number): WalkNetwork {
  const originLng = -71.066;
  const originLat = 42.348;
  const step = 0.0009; // ~75-100 m

  const nodes: WalkNetwork["nodes"] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      nodes.push({ c: [originLng + col * step, originLat + row * step] as [number, number] });
    }
  }

  const edges: WalkNetwork["edges"] = [];
  const adj: number[][] = Array.from({ length: n * n }, () => []);
  const connect = (a: number, b: number, name: string) => {
    const len = metresBetween(nodes[a].c, nodes[b].c);
    const index = edges.length;
    edges.push({ a, b, len, name, geom: [] as [number, number][] });
    adj[a].push(index);
    adj[b].push(index);
  };

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const here = row * n + col;
      if (col + 1 < n) connect(here, row * n + col + 1, `Street ${row}`);
      if (row + 1 < n) connect(here, (row + 1) * n + col, `Avenue ${col}`);
    }
  }

  return { generatedAt: new Date(0).toISOString(), nodes, edges, adj };
}

const N = 7;
const grid = buildGrid(N);
const start = 0; // bottom-left
const goal = N * N - 1; // top-right

// A degree of longitude is shorter than a degree of latitude at this
// latitude, so the lattice's horizontal and vertical blocks are NOT the same
// length (~74 m vs ~100 m). Any monotone staircase therefore costs
// (N-1) of each, not 2*(N-1) of one.
const horizontalLen = metresBetween(grid.nodes[0].c, grid.nodes[1].c);
const verticalLen = metresBetween(grid.nodes[0].c, grid.nodes[N].c);
const idealShortest = (N - 1) * (horizontalLen + verticalLen);

console.log(`\nGrid ${N}x${N}: ${grid.nodes.length} nodes, ${grid.edges.length} edges\n`);

console.log("Uniform exposure (every edge equally sunny)");
{
  const exposure = new Array(grid.edges.length).fill(100);
  const routes = planRoutes(grid, exposure, start, goal);
  check("returns at least 3 routes", routes.length >= 3, `(got ${routes.length})`);

  // Every monotone staircase costs the same: (N-1) horizontal blocks plus
  // (N-1) vertical ones.
  const shortest = Math.min(...routes.map((r) => r.distanceM));
  check(
    "shortest route is the true minimum",
    Math.abs(shortest - idealShortest) < 1,
    `(got ${shortest.toFixed(0)}m, ideal ${idealShortest.toFixed(0)}m)`,
  );

  check(
    "all routes are connected start to goal",
    routes.every((r) => r.nodes[0] === start && r.nodes[r.nodes.length - 1] === goal),
  );
  check(
    "route polylines are drawable",
    routes.every((r) => r.line.length >= 2),
  );
  check(
    "walking time follows distance",
    routes.every((r) => Math.abs(r.seconds - r.distanceM / 1.1) < 1),
  );
}

console.log("\nShaded corridor (one row and one column fully shaded)");
{
  // Shade the bottom row and the right column: an L-shaped shaded corridor
  // from start to goal, exactly as long as any other staircase.
  const exposure = new Array(grid.edges.length).fill(100);
  grid.edges.forEach((edge, i) => {
    const rowA = Math.floor(edge.a / N);
    const colA = edge.a % N;
    const rowB = Math.floor(edge.b / N);
    const colB = edge.b % N;
    const alongBottom = rowA === 0 && rowB === 0;
    const alongRight = colA === N - 1 && colB === N - 1;
    if (alongBottom || alongRight) exposure[i] = 0;
  });

  const routes = planRoutes(grid, exposure, start, goal);
  check("returns at least 3 routes", routes.length >= 3, `(got ${routes.length})`);

  const shadiest = routes[0];
  check(
    "shadiest route uses the shaded corridor",
    shadiest.shadePercent > 95,
    `(got ${shadiest.shadePercent.toFixed(1)}% shade)`,
  );

  // The corridor is itself a monotone staircase, so shade costs nothing here.
  check(
    "shadiest route takes no detour when shade is free",
    shadiest.distanceM < idealShortest * 1.02,
    `(got ${shadiest.distanceM.toFixed(0)}m, ideal ${idealShortest.toFixed(0)}m)`,
  );

  const sunniest = routes[routes.length - 1];
  check(
    "routes span a real range of shade",
    shadiest.shadePercent - sunniest.shadePercent > 20,
    `(${shadiest.shadePercent.toFixed(0)}% vs ${sunniest.shadePercent.toFixed(0)}%)`,
  );
}

console.log("\nShade costs a detour (shaded path is longer)");
{
  // Shade ONLY the long way round: up the left column then across the top.
  const exposure = new Array(grid.edges.length).fill(100);
  grid.edges.forEach((edge, i) => {
    const colA = edge.a % N;
    const colB = edge.b % N;
    const rowA = Math.floor(edge.a / N);
    const rowB = Math.floor(edge.b / N);
    const alongLeft = colA === 0 && colB === 0;
    const alongTop = rowA === N - 1 && rowB === N - 1;
    if (alongLeft || alongTop) exposure[i] = 0;
  });

  const routes = planRoutes(grid, exposure, start, goal);
  const shadiest = routes[0];
  const shortest = [...routes].sort((a, b) => a.distanceM - b.distanceM)[0];

  check(
    "shade preference finds the shaded way round",
    shadiest.shadePercent > 90,
    `(got ${shadiest.shadePercent.toFixed(1)}%)`,
  );
  check(
    "a shortest-preference route is still offered",
    shortest.distanceM <= shadiest.distanceM,
    `(shortest ${shortest.distanceM.toFixed(0)}m vs shadiest ${shadiest.distanceM.toFixed(0)}m)`,
  );
  check(
    "detour stays bounded",
    shadiest.distanceM < shortest.distanceM * 2.0,
    `(shadiest ${shadiest.distanceM.toFixed(0)}m vs shortest ${shortest.distanceM.toFixed(0)}m)`,
  );
}

console.log("\nAlternatives are genuinely different");
{
  const exposure = new Array(grid.edges.length).fill(50);
  grid.edges.forEach((edge, i) => {
    if (i % 3 === 0) exposure[i] = 0;
  });
  const routes = planRoutes(grid, exposure, start, goal);
  check("returns at least 3 routes", routes.length >= 3, `(got ${routes.length})`);

  let maximumOverlap = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const setB = new Set(routes[j].edges);
      const shared = routes[i].edges.filter((e) => setB.has(e)).length;
      maximumOverlap = Math.max(maximumOverlap, shared / routes[i].edges.length);
    }
  }
  check(
    "no two routes are the same road",
    maximumOverlap < 0.9,
    `(max overlap ${(maximumOverlap * 100).toFixed(0)}%)`,
  );
}

console.log("\nEdge cases");
{
  const exposure = new Array(grid.edges.length).fill(50);
  check("start === goal yields nothing", planRoutes(grid, exposure, 5, 5).length === 0);

  // A node with no edges cannot be reached.
  const isolated: WalkNetwork = {
    ...grid,
    nodes: [...grid.nodes, { c: [-71.0, 42.4] as [number, number] }],
    adj: [...grid.adj, []],
  };
  check(
    "unreachable goal yields nothing rather than throwing",
    planRoutes(isolated, exposure, 0, isolated.nodes.length - 1).length === 0,
  );

  // Missing exposure data must not break routing — it defaults to half sun.
  check(
    "missing exposure entries do not crash",
    planRoutes(grid, [], start, goal).length >= 1,
  );
}

console.log(
  failures === 0
    ? "\nAll routing checks passed.\n"
    : `\n${failures} routing check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
