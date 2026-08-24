/**
 * Sanity checks for the real Chinatown pedestrian network.
 *
 * verify-routing.ts proves the algorithm on a synthetic grid. This proves
 * the *data*: that the graph built from City sidewalk centrelines is
 * connected, covers the whole bbox rather than one corner, and produces
 * walking distances a person would recognise between real Chinatown
 * landmarks.
 *
 * Run with: npm run verify:network  (after npm run build:network)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { metresBetween, nearestNode, type WalkNetwork } from "../src/lib/network";
import { planRoutes } from "../src/lib/routing";
import { CHINATOWN_BBOX } from "../src/lib/chinatown";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures += 1;
}

const network = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "network.json"), "utf8"),
) as WalkNetwork;

console.log(
  `\nNetwork: ${network.nodes.length} nodes, ${network.edges.length} edges\n`,
);

console.log("Structure");
{
  check("has a usable number of nodes", network.nodes.length > 300, `(${network.nodes.length})`);
  check("has a usable number of edges", network.edges.length > 400, `(${network.edges.length})`);
  check(
    "every edge references real nodes",
    network.edges.every(
      (e) =>
        e.a >= 0 && e.a < network.nodes.length && e.b >= 0 && e.b < network.nodes.length,
    ),
  );
  check(
    "no self-loops",
    network.edges.every((e) => e.a !== e.b),
  );
  check(
    "every edge has positive length",
    network.edges.every((e) => e.len > 0),
  );
  check(
    "adjacency matches edges",
    network.edges.every((e, i) => network.adj[e.a].includes(i) && network.adj[e.b].includes(i)),
  );
  check(
    "no isolated nodes",
    network.adj.every((list) => list.length > 0),
  );
}

console.log("\nConnectivity");
{
  // Flood fill from node 0 must reach everything: build-network keeps only
  // the largest component, so anything unreachable is a bug in that step.
  const seen = new Uint8Array(network.nodes.length);
  const stack = [0];
  seen[0] = 1;
  let reached = 1;
  while (stack.length) {
    const node = stack.pop()!;
    for (const edgeIndex of network.adj[node]) {
      const edge = network.edges[edgeIndex];
      const next = edge.a === node ? edge.b : edge.a;
      if (!seen[next]) {
        seen[next] = 1;
        reached += 1;
        stack.push(next);
      }
    }
  }
  check(
    "the whole graph is one connected component",
    reached === network.nodes.length,
    `(${reached}/${network.nodes.length} reachable)`,
  );
}

console.log("\nCoverage of the Chinatown bbox");
{
  const { west, south, east, north } = CHINATOWN_BBOX;
  const inside = network.nodes.filter(
    (n) => n.c[0] >= west && n.c[0] <= east && n.c[1] >= south && n.c[1] <= north,
  );
  check(
    "most nodes sit inside the bbox",
    inside.length / network.nodes.length > 0.8,
    `(${inside.length}/${network.nodes.length})`,
  );

  // Split the bbox into quarters; a network that only covers one corner
  // would pass a node count but be useless for routing across the area.
  const midLng = (west + east) / 2;
  const midLat = (south + north) / 2;
  const quadrants = [0, 0, 0, 0];
  for (const n of inside) {
    const q = (n.c[0] > midLng ? 1 : 0) + (n.c[1] > midLat ? 2 : 0);
    quadrants[q] += 1;
  }
  check(
    "all four quadrants of the bbox have nodes",
    quadrants.every((q) => q > 20),
    `(${quadrants.join(", ")})`,
  );
}

console.log("\nRouting between real Chinatown places");
{
  // Coordinates confirmed from the City POI layers used elsewhere in this
  // repo, so these are real places a resident would actually walk between.
  const places: Array<{ name: string; c: [number, number] }> = [
    { name: "Chinatown Gate (Beach St)", c: [-71.06222, 42.35148] },
    { name: "Tufts Medical Center", c: [-71.06352, 42.34965] },
    { name: "Chinatown library branch", c: [-71.06314, 42.35214] },
    { name: "CVS, 35 Kneeland St", c: [-71.06133, 42.35063] },
    { name: "South Station area", c: [-71.05559, 42.35235] },
  ];

  const exposure = new Array(network.edges.length).fill(50);

  for (let i = 0; i < places.length - 1; i++) {
    const from = places[i];
    const to = places[i + 1];
    const a = nearestNode(network, from.c);
    const b = nearestNode(network, to.c);

    const snapA = metresBetween(network.nodes[a].c, from.c);
    const snapB = metresBetween(network.nodes[b].c, to.c);
    check(
      `"${from.name}" snaps to the network`,
      snapA < 60,
      `(${snapA.toFixed(0)}m away)`,
    );

    const routes = planRoutes(network, exposure, a, b);
    const straight = metresBetween(network.nodes[a].c, network.nodes[b].c);
    const best = routes.length ? Math.min(...routes.map((r) => r.distanceM)) : Infinity;

    check(
      `${from.name} -> ${to.name}: at least 3 routes`,
      routes.length >= 3,
      `(got ${routes.length})`,
    );
    check(
      `${from.name} -> ${to.name}: walking distance is plausible`,
      best >= straight && best < straight * 2.2,
      `(walk ${best.toFixed(0)}m vs straight line ${straight.toFixed(0)}m, snapB ${snapB.toFixed(0)}m)`,
    );

    const minutes = best / 1.1 / 60;
    console.log(
      `        ${from.name} -> ${to.name}: ${best.toFixed(0)}m, ~${minutes.toFixed(0)} min, ` +
        `${routes.length} routes`,
    );
  }
}

console.log("\nStreet names");
{
  const named = network.edges.filter((e) => e.name).length;
  check(
    "most walkable edges carry a street name",
    named / network.edges.length > 0.4,
    `(${named}/${network.edges.length})`,
  );
  const names = new Set(network.edges.map((e) => e.name).filter(Boolean));
  check("a plausible variety of street names", names.size > 15, `(${names.size} distinct)`);
  console.log(`        e.g. ${[...names].slice(0, 8).join(", ")}`);
}

console.log(
  failures === 0
    ? "\nAll network checks passed.\n"
    : `\n${failures} network check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
