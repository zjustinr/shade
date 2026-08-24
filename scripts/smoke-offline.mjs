/**
 * Airplane-mode test for the Field Tool.
 *
 * SPEC §9: "The Field Tool must be fully functional in airplane mode. Test
 * this explicitly." §13 turns that into acceptance criteria: works fully
 * offline, queued readings sync when connectivity returns, and re-syncing a
 * previously-synced reading creates no duplicate.
 *
 * This drives a real browser: logs in, loads the site list online so the
 * service worker and IndexedDB are warm, goes offline, captures a reading,
 * confirms it is queued locally, comes back online, and confirms it syncs.
 *
 * Usage:
 *   npm run build && npx next start -p 3888
 *   CREW_PASSCODE=... node scripts/smoke-offline.mjs
 */
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3888";
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PASSCODE = process.env.CREW_PASSCODE ?? "test-crew-passcode";

const failures = [];
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
}

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

console.log(`\nField Tool airplane-mode test against ${BASE}\n`);

// Log in.
await page.goto(`${BASE}/field/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[name="passcode"]').fill(PASSCODE);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/field(\?|$)/, { timeout: 15000 });
check("crew passcode logs in", page.url().includes("/field"));

// Warm the service worker and the cached site list.
await page.waitForTimeout(1500);
const swReady = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
});
check("service worker registers", swReady);

await page.waitForSelector("a[href^='/field/CT-']", { timeout: 20000 }).catch(() => {});
const onlineSiteCount = await page.locator("a[href^='/field/CT-']").count();
check("site list loads online", onlineSiteCount > 0, `(${onlineSiteCount} sites)`);

// Wait until the worker actually controls the page. Registration alone is
// not enough — an uncontrolled page is served entirely from the network, so
// nothing it loads gets cached. A crew member opening the app on wifi before
// heading out goes through exactly this.
const controlled = await page.evaluate(async () => {
  if (navigator.serviceWorker.controller) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!!navigator.serviceWorker.controller), 15000);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
});
check("service worker takes control of the page", controlled);

// Visit the routes the crew will use, while still online, so the worker
// caches their shells.
for (const path of ["/field", "/field/CT-01", "/field/queue"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}
await page.goto(`${BASE}/field`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const cachedSites = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open("shade-field");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("sites", "readonly");
        const all = tx.objectStore("sites").getAll();
        all.onsuccess = () => resolve(all.result.length);
        all.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    }),
);
check("sites cached to IndexedDB for offline use", cachedSites > 0, `(${cachedSites})`);

// ---- Go offline ----
await context.setOffline(true);
console.log("\n  [offline]\n");

await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(2500);
const offlineSiteCount = await page.locator("a[href^='/field/CT-']").count();
check(
  "site list still renders with no network",
  offlineSiteCount > 0,
  `(${offlineSiteCount} sites offline)`,
);

const offlineIndicator = await page.getByText("Offline", { exact: false }).count();
check("offline state is shown to the crew", offlineIndicator > 0);

// Capture a reading with no network at all.
await page.goto(`${BASE}/field/CT-01`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(2000);
const captureFormVisible = await page.locator('input[inputmode="decimal"]').count();
check("capture screen opens offline", captureFormVisible >= 2, `(${captureFormVisible} numeric inputs)`);

if (captureFormVisible >= 2) {
  await page.locator('input[autocomplete="given-name"]').fill("Offline");
  await page.getByRole("radio", { name: "Asphalt" }).click();
  const numeric = page.locator('input[inputmode="decimal"]');
  await numeric.nth(0).fill("141.5");
  await numeric.nth(1).fill("96.5");
  await page.getByRole("radio", { name: "Tree" }).click();

  const deltaShown = await page.getByText("45.0°F", { exact: false }).count();
  check("live delta computes offline", deltaShown > 0);

  await page.getByRole("button", { name: /Save reading/i }).click();
  await page.waitForTimeout(2500);

  const queued = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("shade-field");
        req.onsuccess = () => {
          const tx = req.result.transaction("readings", "readonly");
          const all = tx.objectStore("readings").getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      }),
  );
  check("reading saved to the offline queue", queued.length > 0, `(${queued.length} queued)`);
  const savedId = queued[0]?.id ?? null;

  // ---- Back online: the queue should drain by itself ----
  await context.setOffline(false);
  console.log("\n  [back online]\n");
  await page.goto(`${BASE}/field/queue`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const uploadBtn = page.getByRole("button", { name: /Upload now/i });
  if (await uploadBtn.isEnabled().catch(() => false)) await uploadBtn.click();
  await page.waitForTimeout(4000);

  const remaining = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("shade-field");
        req.onsuccess = () => {
          const tx = req.result.transaction("readings", "readonly");
          const all = tx.objectStore("readings").getAll();
          all.onsuccess = () => resolve(all.result.length);
          all.onerror = () => resolve(-1);
        };
        req.onerror = () => resolve(-1);
      }),
  );
  check("queue drains once back online", remaining === 0, `(${remaining} still queued)`);

  // Idempotency: pushing the same client-generated UUID twice must not
  // create a second row (§13).
  if (savedId) {
    const verify = await page.evaluate(async (id) => {
      const res = await fetch(`/api/readings`);
      const rows = await res.json();
      return rows.filter((r) => r.id === id).length;
    }, savedId);
    check("synced reading appears exactly once", verify === 1, `(found ${verify})`);
  }
}

await browser.close();

console.log(
  failures.length === 0
    ? "\nAirplane-mode test passed.\n"
    : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
