/**
 * Verifies the three message catalogs stay structurally identical, and
 * reports community-review status.
 *
 * A missing key does not crash next-intl — it renders the key path as
 * literal text. On a trilingual site whose whole point is reaching people
 * who don't read English, that failure is invisible to the person shipping
 * it and useless to the person reading it. Hence this check.
 *
 * Run with: npm run check:i18n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { locales } from "../src/i18n/routing";

type Catalog = Record<string, unknown>;

const MESSAGES_DIR = join(process.cwd(), "src", "messages");
const REFERENCE_LOCALE = "en";

function flatten(obj: Catalog, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    if (key.startsWith("_")) return []; // _meta is bookkeeping, not a message
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object"
      ? flatten(value as Catalog, path)
      : [path];
  });
}

/** ICU placeholders like {skipped} must match across locales, or an
 *  interpolated value silently vanishes in one language only. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

function valueAt(obj: Catalog, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Catalog)[key];
  }, obj);
}

const catalogs = new Map<string, Catalog>();
for (const locale of locales) {
  catalogs.set(
    locale,
    JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Catalog,
  );
}

const reference = catalogs.get(REFERENCE_LOCALE)!;
const referenceKeys = flatten(reference);
let problems = 0;

console.log(`\nReference locale ${REFERENCE_LOCALE}: ${referenceKeys.length} messages\n`);

for (const locale of locales) {
  if (locale === REFERENCE_LOCALE) continue;
  const catalog = catalogs.get(locale)!;
  const keys = new Set(flatten(catalog));

  const missing = referenceKeys.filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !referenceKeys.includes(k));

  const placeholderMismatches: string[] = [];
  for (const key of referenceKeys) {
    if (!keys.has(key)) continue;
    const refValue = valueAt(reference, key);
    const locValue = valueAt(catalog, key);
    if (typeof refValue !== "string" || typeof locValue !== "string") continue;
    const a = placeholders(refValue).join(",");
    const b = placeholders(locValue).join(",");
    if (a !== b) placeholderMismatches.push(`${key} (en: {${a}} vs ${locale}: {${b}})`);
  }

  // Catch a value left verbatim in English — usually an untranslated string.
  const identical = referenceKeys.filter((key) => {
    if (!keys.has(key)) return false;
    const refValue = valueAt(reference, key);
    const locValue = valueAt(catalog, key);
    return typeof refValue === "string" && refValue === locValue && refValue.length > 3;
  });

  const meta = catalog._meta as { reviewStatus?: string } | undefined;
  const review = meta?.reviewStatus ?? "UNKNOWN";

  console.log(`${locale}: ${keys.size} messages · review status ${review}`);
  if (missing.length) {
    problems += missing.length;
    console.log(`  MISSING (${missing.length}): ${missing.join(", ")}`);
  }
  if (extra.length) {
    problems += extra.length;
    console.log(`  EXTRA (${extra.length}): ${extra.join(", ")}`);
  }
  if (placeholderMismatches.length) {
    problems += placeholderMismatches.length;
    console.log(`  PLACEHOLDER MISMATCH: ${placeholderMismatches.join("; ")}`);
  }
  if (identical.length) {
    console.log(`  still identical to English (${identical.length}): ${identical.join(", ")}`);
  }
  if (review !== "COMMUNITY_REVIEWED") {
    console.log(
      `  NOT YET COMMUNITY-REVIEWED — §8 requires review before public launch.`,
    );
  }
  console.log();
}

if (problems > 0) {
  console.log(`${problems} structural problem(s) found.\n`);
  process.exit(1);
}
console.log("All catalogs structurally in sync.\n");
