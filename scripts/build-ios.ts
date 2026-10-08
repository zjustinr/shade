/**
 * Builds the iOS (Capacitor) bundle: a fully static export of the PUBLIC
 * app — map, route planner, corners, about, print sheets — written to out/.
 *
 * What is deliberately NOT in the bundle:
 *  - /field and /admin. They need the server (auth, sync) and shipping a
 *    passcode-gated section in an App Store build invites Apple's review
 *    team to demand working credentials (Guideline 2.1). The crew keeps
 *    using the installable web app, which is better suited to their job
 *    anyway (same-day fixes, no App Review between them and a deadline).
 *  - /api. Route handlers cannot exist in a static export; the bundled app
 *    reads live data from the production API instead (NEXT_PUBLIC_API_BASE,
 *    CORS-opened read-only endpoints under /api/public/).
 *  - The service worker. The bundle itself is the offline cache.
 *
 * Mechanics: Next refuses to export dynamic server code, so the script
 * moves the server-only segments aside and strips the two `revalidate`
 * exports (ISR has no meaning in an export) for the duration of the build,
 * then restores everything, build failed or not.
 *
 * Run with: npm run build:ios          (then: npx cap sync ios, on a Mac)
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const stash = join(root, ".ios-build-stash");

/** Server-only segments that cannot exist in a static export. */
const MOVED = ["src/app/api", "src/app/field", "src/app/admin", "src/proxy.ts"];

/** Files whose `revalidate` export must be stripped for the export build. */
const REVALIDATE_FILES = [
  "src/app/[locale]/map/page.tsx",
  "src/app/[locale]/corners/page.tsx",
];
const REVALIDATE_LINE = "export const revalidate = 300;";

const originals = new Map<string, string>();

function moveAside() {
  rmSync(stash, { recursive: true, force: true });
  mkdirSync(stash, { recursive: true });
  for (const rel of MOVED) {
    const from = join(root, rel);
    if (!existsSync(from)) continue;
    const to = join(stash, rel.replace(/\//g, "__"));
    renameSync(from, to);
  }
  for (const rel of REVALIDATE_FILES) {
    const path = join(root, rel);
    const source = readFileSync(path, "utf8");
    if (!source.includes(REVALIDATE_LINE)) {
      throw new Error(
        `${rel} no longer contains "${REVALIDATE_LINE}" — update scripts/build-ios.ts.`,
      );
    }
    originals.set(path, source);
    writeFileSync(
      path,
      source.replace(
        REVALIDATE_LINE,
        "// revalidate stripped for the static iOS export (see scripts/build-ios.ts)",
      ),
    );
  }
}

function restore() {
  for (const [path, source] of originals) writeFileSync(path, source);
  for (const rel of MOVED) {
    const from = join(stash, rel.replace(/\//g, "__"));
    if (existsSync(from)) renameSync(from, join(root, rel));
  }
  rmSync(stash, { recursive: true, force: true });
}

function run(command: string, extraEnv: Record<string, string> = {}) {
  execSync(command, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

function main() {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE ?? "https://chinatown-cool-corners.vercel.app";
  const basemap =
    process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ??
    "https://tiles.openfreemap.org/styles/positron";

  console.log(`iOS bundle build\n  API:     ${apiBase}\n  basemap: ${basemap}\n`);

  rmSync(join(root, "out"), { recursive: true, force: true });
  run("npm run copy:worker");

  moveAside();
  try {
    run("npx next build --webpack", {
      IOS_BUILD: "1",
      NEXT_PUBLIC_STATIC_BUNDLE: "1",
      NEXT_PUBLIC_API_BASE: apiBase,
      NEXT_PUBLIC_BASEMAP_STYLE_URL: basemap,
    });
  } finally {
    restore();
  }

  const out = join(root, "out");

  // public/ may hold a service worker from an earlier web build; it has no
  // business in the native bundle.
  for (const file of ["sw.js", "sw.js.map"]) rmSync(join(out, file), { force: true });
  execSync(`find ${JSON.stringify(out)} -maxdepth 1 -name 'workbox-*.js*' -delete`);

  // Entry point: Capacitor loads /index.html. Land people on the map in
  // their own language — §8 is why this app exists in three of them.
  writeFileSync(
    join(out, "index.html"),
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cool Corners</title>
<script>
(function () {
  var languages = navigator.languages || [navigator.language || "en"];
  var locale = "en";
  for (var i = 0; i < languages.length; i++) {
    var tag = String(languages[i]).toLowerCase();
    if (tag.indexOf("zh") === 0) { locale = "zh-Hant"; break; }
    if (tag.indexOf("vi") === 0) { locale = "vi"; break; }
    if (tag.indexOf("en") === 0) { break; }
  }
  location.replace("/" + locale + "/map/");
})();
</script>
</head>
<body></body>
</html>
`,
  );

  // Fail the build if the export is not actually usable.
  const mustExist = [
    "en/map/index.html",
    "zh-Hant/map/index.html",
    "vi/map/index.html",
    "data/network.json",
    "data/destinations.geojson",
    "data/shade/index.json",
  ];
  const missing = mustExist.filter((rel) => !existsSync(join(out, rel)));
  if (missing.length) {
    throw new Error(`Export is missing: ${missing.join(", ")}`);
  }
  const forbidden = ["field", "admin", "api", "sw.js"].filter((rel) =>
    existsSync(join(out, rel)),
  );
  if (forbidden.length) {
    throw new Error(
      `Export contains server-only or web-only artefacts: ${forbidden.join(", ")}`,
    );
  }

  const sizeKb = Number(
    execSync(`du -sk ${JSON.stringify(out)}`).toString().split("\t")[0],
  );
  console.log(
    `\niOS web bundle ready in out/ (${(sizeKb / 1024).toFixed(1)} MB).` +
      `\nNext, on a Mac: npx cap sync ios && npx cap open ios  (docs/ios-app-store.md)`,
  );
}

try {
  main();
} catch (err) {
  restore();
  console.error(err);
  process.exit(1);
}
