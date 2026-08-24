/**
 * Fails the build if no service worker was emitted.
 *
 * next-pwa works by hooking Next's webpack config. Under Turbopack — which
 * Next 16 uses by default — the hook never runs, the build succeeds, and no
 * service worker is produced. Nothing warns you. The Field Tool would then
 * ship with no offline support at all while every other check stayed green,
 * and §13 requires it to work in airplane mode.
 *
 * Runs as postbuild.
 */
import { access } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const PUBLIC_DIR = join(process.cwd(), "public");

async function main() {
  try {
    await access(join(PUBLIC_DIR, "sw.js"));
  } catch {
    console.error(
      "\nNo service worker at public/sw.js.\n\n" +
        "next-pwa only runs under webpack. Build with `next build --webpack`\n" +
        "(the `build` script already does). Without it the Field Tool has no\n" +
        "offline support, which SPEC §9 and §13 require.\n",
    );
    process.exit(1);
  }

  const workbox = (await readdir(PUBLIC_DIR)).filter((f) => /^workbox-.*\.js$/.test(f));
  if (workbox.length === 0) {
    console.error("\nsw.js exists but no workbox runtime was emitted alongside it.\n");
    process.exit(1);
  }

  console.log(`Service worker present: public/sw.js + ${workbox[0]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
