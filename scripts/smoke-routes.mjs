/**
 * Browser test for the destinations layer and the shaded route planner.
 *
 * Same reasoning as smoke-map.mjs: a routing feature that silently returns
 * nothing, or draws a line that is not actually on the sidewalk network,
 * looks fine in a screenshot and fine in a build. This drives the real UI
 * and checks the numbers it reports.
 *
 * Usage:
 *   npm run build && npx next start -p 4777
 *   PORT=4777 node scripts/smoke-routes.mjs
 */
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "4777";
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const failures = [];
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

console.log(`\nRoute planner smoke test against ${BASE}/en/map\n`);

await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 });
await page.waitForTimeout(6000);

// --- Destinations ---
check(
  "destinations layer toggle is present",
  (await page.getByText("Places to walk to", { exact: false }).count()) > 0,
);
check(
  "category filters are present",
  (await page.getByRole("checkbox", { name: /Pharmacies/i }).count()) > 0,
);
check(
  "restaurants start hidden to avoid burying the shade layer",
  (await page.getByRole("checkbox", { name: /Restaurants/i }).isChecked()) === false,
);
check(
  "the public-housing data gap is stated",
  (await page.getByText("no development inside Chinatown", { exact: false }).count()) > 0,
);

// --- Open the planner ---
await page.getByRole("button", { name: /Plan a shaded walk/i }).first().click();
await page.waitForTimeout(3000);
check(
  "planner opens",
  (await page.getByText("Tap the map to set", { exact: false }).count()) > 0 ||
    (await page.getByRole("button", { name: /Set start/i }).count()) > 0,
);

// --- Set start and destination by search, which is deterministic ---
async function pickPlace(which, query) {
  await page.locator('select[aria-label="Search for a place"]').selectOption(which);
  await page.locator("#place-search").fill(query);
  await page.waitForTimeout(700);
  const option = page.locator("#place-search").locator("xpath=../..").locator("button").first();
  await option.click();
  await page.waitForTimeout(500);
}

await pickPlace("start", "Chinatown");
await pickPlace("end", "Tufts Medical Center");
await page.waitForTimeout(3500);

const routeCards = await page.locator('button[aria-pressed]').filter({ hasText: "in shade" });
const routeCount = await routeCards.count();
check("at least 3 routes are suggested", routeCount >= 3, `(got ${routeCount})`);

// --- The reported numbers must be sane ---
/** Read each figure from its own labelled element rather than from the
 *  card's concatenated text, which has no separators between numbers. */
const readStats = (els) =>
  els.map((el) => {
    const num = (stat) => {
      const node = el.querySelector(`[data-stat="${stat}"] dd`);
      const digits = (node?.textContent ?? "").match(/\d+/);
      return digits ? Number(digits[0]) : NaN;
    };
    return { shade: num("shade"), metres: num("distance"), minutes: num("duration") };
  });

const stats = await routeCards.evaluateAll(readStats);
console.log("        routes:", JSON.stringify(stats));

check(
  "every route reports a shade share in 0-100",
  stats.every((s) => Number.isFinite(s.shade) && s.shade >= 0 && s.shade <= 100),
);
check(
  "every route reports a plausible distance",
  stats.every((s) => Number.isFinite(s.metres) && s.metres > 20 && s.metres < 5000),
);
check(
  "walking time is consistent with distance",
  stats.every((s) => Math.abs(s.minutes - s.metres / 1.1 / 60) < 1.5),
);
check(
  "routes are sorted shadiest first",
  stats.every((s, i) => i === 0 || stats[i - 1].shade >= s.shade),
);
check(
  "the alternatives differ from one another",
  new Set(stats.map((s) => `${s.shade}-${s.metres}`)).size > 1,
);

// --- Preference must actually change the answer ---
const shadiestUnderShade = stats[0]?.shade ?? 0;
await page.getByRole("radio", { name: /Shortest walk/i }).click();
await page.waitForTimeout(3000);
const shortestStats = await routeCards.evaluateAll(readStats);
console.log("        shortest-preference routes:", JSON.stringify(shortestStats));
const minUnderShortest = Math.min(...shortestStats.map((s) => s.metres));
const minUnderShade = Math.min(...stats.map((s) => s.metres));
check(
  "shortest preference offers a walk no longer than the shade preference did",
  minUnderShortest <= minUnderShade,
  `(${minUnderShortest}m vs ${minUnderShade}m)`,
);
check(
  "shade preference produced a genuinely shaded option",
  shadiestUnderShade > 0,
  `(${shadiestUnderShade}%)`,
);

// --- Which-is-which: badges, colours, and selection ---
// Map badges are standalone buttons whose accessible name is exactly
// "Route N"; the cards contain that text plus stats, so aria-label match
// keeps the two apart.
const badge = (n) => page.locator(`button[aria-label="Route ${n}"]`);
check("numbered badges sit on the map lines", (await badge(1).count()) === 1 && (await badge(2).count()) === 1 && (await badge(3).count()) === 1);

const badgeColours = [];
for (const n of [1, 2, 3]) {
  badgeColours.push(
    await badge(n).evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null),
  );
}
check(
  "each route badge has a distinct colour",
  new Set(badgeColours).size === badgeColours.length,
  `(${badgeColours.join(" | ")})`,
);

// The card's swatch must be the same colour as the map badge — that match
// is what answers "which line is Route 2".
const cardSwatch = await routeCards
  .nth(1)
  .locator("span[aria-hidden]")
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundColor)
  .catch(() => null);
check(
  "card swatch matches the map badge for the same route",
  cardSwatch === badgeColours[1],
  `(card ${cardSwatch} vs badge ${badgeColours[1]})`,
);

// Selection: route 1 starts selected; clicking badge 2 must move the
// highlight to card 2 and to badge 2.
check("route 1 starts selected", (await routeCards.nth(0).getAttribute("aria-pressed")) === "true");
await badge(2).click();
await page.waitForTimeout(800);
check(
  "clicking a map badge selects that route's card",
  (await routeCards.nth(1).getAttribute("aria-pressed")) === "true" &&
    (await routeCards.nth(0).getAttribute("aria-pressed")) === "false",
);
check(
  "the selected badge is visibly larger",
  await badge(2).evaluate((el) => el.offsetWidth) >
    (await badge(1).evaluate((el) => el.offsetWidth)),
);
await routeCards.nth(2).click();
await page.waitForTimeout(800);
check(
  "clicking a card moves the selection there",
  (await routeCards.nth(2).getAttribute("aria-pressed")) === "true" &&
    (await badge(3).getAttribute("aria-pressed")) === "true",
);

// --- The route must be drawn ---
const drawn = await page.evaluate(() => {
  const canvas = document.querySelector("canvas.maplibregl-canvas");
  return canvas ? canvas.width > 0 && canvas.height > 0 : false;
});
check("map canvas still healthy after routing", drawn);

await page.screenshot({ path: "/var/tmp/route-planner.png", fullPage: true });

check("no console errors", errors.length === 0, `(${errors.slice(0, 2).join(" | ")})`);

await browser.close();
console.log(
  failures.length === 0
    ? "\nRoute planner smoke test passed.\n"
    : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
