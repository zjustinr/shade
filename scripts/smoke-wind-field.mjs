/**
 * Browser test for the wind fields on the Field Tool capture form.
 *
 * Drives the real form: logs in, fills a reading, records wind in m/s,
 * and checks what actually lands in the phone's offline queue (IndexedDB) —
 * the unit conversion, the warnings, and that wind stays optional. It does
 * not need a database: the form saves to the phone first, and that queue is
 * what is inspected. (The upload to the server is covered by
 * smoke-offline.mjs, which does need one.)
 *
 * Usage:
 *   npm run build && CREW_PASSCODE=test-crew-passcode npx next start -p 3999
 *   PORT=3999 node scripts/smoke-wind-field.mjs
 */
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3999";
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const PASSCODE = process.env.CREW_PASSCODE ?? "test-crew-passcode";

const failures = [];
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("console", (m) => {
  // The upload to /api/readings has no database behind it in this test, so a
  // failed sync is expected here and is not what is being tested.
  if (m.type() === "error" && !/api\/(readings|sites|coverage)|Failed to load resource/.test(m.text())) {
    consoleErrors.push(m.text());
  }
});

console.log(`\nWind fields on the capture form, against ${BASE}\n`);

await page.goto(`${BASE}/field/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[name="passcode"]').fill(PASSCODE);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/field(\?|$)/, { timeout: 15000 });

async function openForm(site = "CT-01") {
  await page.goto(`${BASE}/field/${site}`, { waitUntil: "networkidle" });
  await page.getByLabel("Your first name").fill("Mei");
  await page.getByLabel("asphalt", { exact: true }).check();
  await page.getByLabel("SUN temperature (°F)").fill("118");
  await page.getByLabel("SHADE temperature (°F)").fill("96");
  await page.getByLabel("tree", { exact: true }).check();
}

async function queued() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("shade-field");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("readings", "readonly");
          const all = tx.objectStore("readings").getAll();
          all.onsuccess = () => resolve(all.result.map((r) => r.reading));
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

// --- A reading with NO wind still saves (wind is optional) ---
await openForm("CT-01");
const summary = page.getByText("Wind (optional)");
check("the wind group is offered, and optional", (await summary.count()) === 1);
check("the wind group starts collapsed so the 60-second flow is unchanged", !(await page.locator("details").first().evaluate((d) => d.open)));
await page.getByRole("button", { name: "Save reading" }).click();
await page.waitForURL(/\/field(\?|$)/, { timeout: 15000 });
let rows = await queued();
const noWind = rows.find((r) => r.siteId === null || true);
check("a reading with no wind saves", rows.length >= 1);
check(
  "...with wind stored as null, not zero (not measured is not calm)",
  rows[0].windMph === null && rows[0].windGustMph === null && rows[0].windFrom === null,
  JSON.stringify({ windMph: rows[0].windMph, gust: rows[0].windGustMph, from: rows[0].windFrom }),
);
void noWind;

// --- A reading with wind recorded in m/s ---
await openForm("CT-02");
await page.getByText("Wind (optional)").click();
await page.getByLabel("Anemometer unit").selectOption("ms");
await page.getByLabel("Wind speed, average (m/s)").fill("5");
check(
  "the labels follow the chosen unit",
  (await page.getByLabel("Highest gust (m/s)").count()) === 1,
);
check(
  "an m/s value shows what will be saved in mph, so a wrong unit is visible",
  (await page.getByText("Saved as 11.2 mph average").count()) === 1,
);

await page.getByLabel("Highest gust (m/s)").fill("3");
check(
  "a gust lower than the average is called out, and still savable",
  (await page.getByText(/gust is lower than the average/i).count()) === 1 &&
    !(await page.getByRole("button", { name: "Save reading" }).isDisabled()),
);
await page.getByLabel("Highest gust (m/s)").fill("8");
await page.getByLabel("west", { exact: false }).or(page.getByLabel("W", { exact: true })).first().check();
check("the compass direction can be chosen", (await page.getByRole("button", { name: "Clear direction" }).count()) === 1);

await page.getByLabel("Wind speed, average (m/s)").fill("30");
check(
  "a very strong wind prompts a check of the unit",
  (await page.getByText(/very strong wind/i).count()) === 1,
);
await page.getByLabel("Wind speed, average (m/s)").fill("60");
check(
  "a wind the server would reject blocks the save, instead of stranding it in the queue",
  (await page.getByRole("button", { name: "Save reading" }).isDisabled()) &&
    (await page.getByText(/stronger than any wind we could record/i).count()) === 1,
);
await page.getByLabel("Wind speed, average (m/s)").fill("abc");
check(
  "text in a wind box is called out and blocks the save, never silently dropped",
  (await page.getByRole("button", { name: "Save reading" }).isDisabled()) &&
    (await page.getByText(/must be numbers/i).count()) === 1,
);
await page.getByLabel("Wind speed, average (m/s)").fill("5");
check("fixing it re-enables the save", !(await page.getByRole("button", { name: "Save reading" }).isDisabled()));

await page.getByRole("button", { name: "Save reading" }).click();
await page.waitForURL(/\/field(\?|$)/, { timeout: 15000 });
rows = await queued();
const withWind = rows.find((r) => r.windMph !== null);
check("the reading with wind is in the queue", !!withWind);
check("5 m/s was stored as 11.2 mph", withWind?.windMph === 11.2, `(got ${withWind?.windMph})`);
check("an 8 m/s gust was stored as 17.9 mph", withWind?.windGustMph === 17.9, `(got ${withWind?.windGustMph})`);
check("the direction was stored", withWind?.windFrom === "W", `(got ${withWind?.windFrom})`);
check("the temperatures were stored too", withWind?.sunTempF === 118 && withWind?.shadeTempF === 96);

// --- The unit is remembered between sites ---
await page.goto(`${BASE}/field/CT-03`, { waitUntil: "networkidle" });
await page.getByText("Wind (optional)").click();
check("the anemometer unit is remembered from last time", (await page.getByLabel("Anemometer unit").inputValue()) === "ms");

check("no unexpected console errors", consoleErrors.length === 0, `(${consoleErrors.join(" | ")})`);

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nWind field smoke test passed.");
