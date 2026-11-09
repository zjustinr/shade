/**
 * Renders every icon the app ships from the one source drawing,
 * brand/logo-mark.svg, so the logo cannot drift between the browser tab,
 * the home-screen icon and the App Store icon.
 *
 *   npm run build:icons
 *
 * Writes:
 *   src/app/icon.svg                 browser tab (vector)
 *   src/app/apple-icon.png           iOS home screen when saved from Safari
 *   src/app/favicon.ico              legacy browsers (PNG-in-ICO, 32 and 48 px)
 *   public/icons/icon-192.png, icon-512.png, icon-maskable-512.png   PWA
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  App Store, 1024 px
 *
 * The header logo (src/components/logo.tsx) repeats the same paths without
 * the background tile; if you change the drawing, change both.
 *
 * Needs a Chromium: set CHROME_PATH, or it uses the Playwright default.
 */
import { chromium } from "playwright";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE = readFileSync("brand/logo-mark.svg", "utf8");
const CHROME = process.env.CHROME_PATH;

// Android "maskable" icons are cropped to a circle that can be as small as
// 80% of the canvas, so the drawing is scaled into the safe zone.
const maskable = SOURCE.replace(
  /(<rect width="512" height="512"[^>]*\/>)/,
  `$1<g transform="translate(256 256) scale(0.7) translate(-256 -256)">`,
).replace("</svg>", "</g></svg>");

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();

async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ type: "png" });
}

const out = {
  "public/icons/icon-192.png": await png(SOURCE, 192),
  "public/icons/icon-512.png": await png(SOURCE, 512),
  "public/icons/icon-maskable-512.png": await png(maskable, 512),
  "src/app/apple-icon.png": await png(SOURCE, 180),
  // The tile is opaque and square: App Store Connect rejects transparency
  // and applies the rounded corners itself.
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png": await png(SOURCE, 1024),
};
for (const [path, data] of Object.entries(out)) writeFileSync(path, data);
copyFileSync("brand/logo-mark.svg", "src/app/icon.svg");

// favicon.ico: an ICO container holding PNG images (supported everywhere
// that still asks for /favicon.ico).
const sizes = [32, 48];
const images = [];
for (const s of sizes) images.push(await png(SOURCE, s));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(sizes[i], at);
  header.writeUInt8(sizes[i], at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(img.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += img.length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([header, ...images]));

await browser.close();
console.log(`wrote ${Object.keys(out).length + 2} icon files from brand/logo-mark.svg`);
