/**
 * Guards the iOS bundle id before anything is built for upload.
 *
 * The bundle id lives in two places that do not sync: appId in
 * capacitor.config.ts, and PRODUCT_BUNDLE_IDENTIFIER in the Xcode project.
 * It also becomes the app's permanent App Store identity at the first
 * upload — change it afterwards and Apple treats the result as a different
 * app. So this fails loudly if the two disagree, and, with --release,
 * refuses the placeholder that ships in the repo, because uploading under a
 * name nobody chose on purpose cannot be undone.
 *
 * Usage:
 *   node scripts/check-ios-bundle-id.mjs             # consistency only
 *   node scripts/check-ios-bundle-id.mjs --release   # also refuse the placeholder
 *
 * Set ALLOW_PLACEHOLDER_BUNDLE_ID=1 to knowingly ship the placeholder.
 */
import { readFileSync } from "node:fs";

const PLACEHOLDER = "org.chinatowncoolcorners.app";
const release = process.argv.includes("--release");

const config = readFileSync("capacitor.config.ts", "utf8");
const appId = config.match(/appId:\s*["']([^"']+)["']/)?.[1];

const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
const projectIds = [
  ...new Set([...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map((m) => m[1].trim())),
];

let failed = false;
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  failed = true;
};

if (!appId) fail("could not read appId from capacitor.config.ts");
if (projectIds.length === 0) fail("no PRODUCT_BUNDLE_IDENTIFIER found in the Xcode project");
if (projectIds.length > 1) fail(`the Xcode project has several bundle ids: ${projectIds.join(", ")}`);
if (appId && projectIds.length === 1 && projectIds[0] !== appId) {
  fail(
    `capacitor.config.ts says "${appId}" but the Xcode project says "${projectIds[0]}". ` +
      "Set the same value in both (the Xcode one is under App target > Signing & Capabilities, " +
      "or PRODUCT_BUNDLE_IDENTIFIER in ios/App/App.xcodeproj/project.pbxproj).",
  );
}
if (appId && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(appId)) {
  fail(`"${appId}" is not a valid reverse-DNS bundle id`);
}

if (release && appId === PLACEHOLDER && process.env.ALLOW_PLACEHOLDER_BUNDLE_ID !== "1") {
  fail(
    `the bundle id is still the placeholder "${PLACEHOLDER}". It becomes permanent at the first ` +
      "upload, so choose it on purpose: edit appId in capacitor.config.ts and PRODUCT_BUNDLE_IDENTIFIER " +
      "in the Xcode project, then retry. (To knowingly ship the placeholder, set the repository " +
      "variable ALLOW_PLACEHOLDER_BUNDLE_ID to 1.)",
  );
}

if (failed) process.exit(1);
console.log(`Bundle id OK: ${appId}${appId === PLACEHOLDER ? " (still the placeholder)" : ""}`);
