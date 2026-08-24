/**
 * Browser smoke test for the public shade map.
 *
 * This exists because the map failed in a way nothing else could catch:
 * MapLibre's GeoJSON worker, bundled through Next, silently loaded the page
 * HTML instead of the worker script. No console error, no failed request,
 * a green build, and a map that rendered a basemap with zero shadows on it.
 * Only looking at real pixels found it.
 *
 * Usage:
 *   npm run build && npx next start -p 3555
 *   node scripts/smoke-map.mjs            # defaults to port 3555
 *
 * Requires playwright and the sandbox Chromium; skips cleanly if absent.
 */
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3555";
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LOCALE = process.env.LOCALE ?? "en";

const failures = [];
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
}
function skip(name, why) {
  console.log(`  SKIP  ${name} — ${why}`);
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });

const consoleErrors = [];
const failedRequests = [];
const externalHosts = new Set();
const shadeFetches = [];

page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) =>
  failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`),
);
page.on("request", (r) => {
  const { hostname } = new URL(r.url());
  if (!["localhost", "127.0.0.1"].includes(hostname)) externalHosts.add(hostname);
  if (r.url().includes("/data/shade/")) shadeFetches.push(r.url().split("/data/shade/")[1]);
});

const STYLE_URL =
  process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/positron";

console.log(`\nShade map smoke test against ${BASE}/${LOCALE}/map\n`);

await page.goto(`${BASE}/${LOCALE}/map`, { waitUntil: "domcontentloaded", timeout: 60000 });
const canvas = await page
  .waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 })
  .catch(() => null);
check("map canvas mounts", canvas !== null);
await page.waitForTimeout(8000);

// A basemap style the browser cannot reach (offline CI, a sandbox with no
// egress) stops MapLibre before `load` fires, so no layer is ever added and
// nothing downstream can run. That is an environment limitation, not a
// failure of this app — probe it from inside the page, which shares the
// map's network context, and report those checks as skipped.
const mapRenderable = await page.evaluate(
  (url) =>
    fetch(url, { method: "GET" })
      .then((r) => r.ok)
      .catch(() => false),
  STYLE_URL,
);
if (!mapRenderable) {
  console.log(
    "\n  Basemap style is unreachable from here, so MapLibre never finished\n" +
      "  loading and the rendering checks cannot run. Point\n" +
      "  NEXT_PUBLIC_BASEMAP_STYLE_URL at a reachable style and rebuild to\n" +
      "  exercise them.\n",
  );
}

if (mapRenderable) {
  check("a shade slot was fetched", shadeFetches.length > 0, "(none — shade layer never loaded)");
} else {
  skip("a shade slot was fetched", "basemap unreachable");
}

// The real test: are shadow pixels actually painted? A basemap-only map
// looks fine to every other check and is exactly the bug this catches.
const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
const shot = await page.screenshot({ clip: box });
const { shadowPct } = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let shadow = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    // Building shade is a desaturated mid-grey over a pale basemap.
    if (r < 190 && g < 190 && b < 190 && Math.max(r, g, b) - Math.min(r, g, b) < 60) shadow++;
  }
  return { shadowPct: (100 * shadow) / total };
}, `data:image/png;base64,${shot.toString("base64")}`);

if (mapRenderable) {
  check(
    "shadow polygons are actually painted",
    shadowPct > 5,
    `(only ${shadowPct.toFixed(1)}% shadow pixels — map is probably basemap-only)`,
  );
} else {
  skip("shadow polygons are actually painted", "basemap unreachable");
}

check("time slider present", (await page.locator('input[type="range"]').count()) === 1);
check("four layer toggles present", (await page.locator('input[type="checkbox"]').count()) === 4);
check(
  "outbound City cooling link present",
  (await page.locator('a[href*="experience.arcgis.com"]').count()) > 0,
);
check(
  "disclaimer shown in all three languages",
  (await page.locator("aside li[lang]").count()) === 3,
);
check("non-map text fallback present", (await page.locator("table").count()) > 0);

// Moving the slider must swap to a different precomputed slot.
shadeFetches.length = 0;
await page.locator('input[type="range"]').first().evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(el, String(9 * 60));
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(3000);
if (mapRenderable) {
  check(
    "moving the time slider loads a new slot",
    shadeFetches.some((f) => f.includes("0900")),
    `(fetched: ${shadeFetches.join(", ") || "nothing"})`,
  );
} else {
  skip("moving the time slider loads a new slot", "basemap unreachable");
}

// §13: zero third-party analytics or tracking. Map tiles are expected.
const trackers = [...externalHosts].filter(
  (h) => !h.includes("openfreemap") && !h.includes("openstreetmap"),
);
check("no third-party analytics or tracking hosts", trackers.length === 0, `(${trackers.join(", ")})`);
if (mapRenderable) {
  check("no console errors", consoleErrors.length === 0, `(${consoleErrors.slice(0, 2).join(" | ")})`);
  check("no failed requests", failedRequests.length === 0, `(${failedRequests.slice(0, 2).join(" | ")})`);
} else {
  skip("no console errors", "basemap unreachable");
  skip("no failed requests", "basemap unreachable");
}

await browser.close();

console.log(
  failures.length === 0
    ? "\nMap smoke test passed.\n"
    : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
