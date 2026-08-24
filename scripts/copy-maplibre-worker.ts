/**
 * Copies MapLibre's web worker into public/ so it can be served as a plain
 * static asset.
 *
 * Bundled through Next, MapLibre's internal worker URL resolution points at
 * the page rather than the worker script; the worker then parses HTML,
 * fails silently, and every GeoJSON source stays permanently empty. Serving
 * the worker file directly and calling setWorkerUrl sidesteps that.
 *
 * Runs automatically via the prebuild/predev npm scripts. Copying from
 * node_modules rather than committing the file keeps it in step with the
 * installed maplibre-gl version.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// The worker is an ES module that imports the shared chunk as a sibling, so
// both files have to sit next to each other under public/.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
  const distDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
  const targetDir = join(process.cwd(), "public");
  await mkdir(targetDir, { recursive: true });

  for (const file of FILES) {
    await copyFile(join(distDir, file), join(targetDir, file));
    console.log(`Copied ${file} -> public/${file}`);
  }
}

main().catch((err) => {
  console.error("Failed to copy the MapLibre worker:", err);
  process.exit(1);
});
