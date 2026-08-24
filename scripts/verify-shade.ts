/**
 * Sanity checks for the shadow geometry in src/lib/shade.ts.
 * Run with: npx tsx scripts/verify-shade.ts
 *
 * These assert physical facts about solar geometry in Boston that must hold
 * regardless of implementation — a sign error in the azimuth conversion puts
 * every shadow on the wrong side of every building, which would look
 * plausible on a map and be completely wrong.
 */
import * as turf from "@turf/turf";
import {
  antiSolarBearing,
  buildingShadow,
  computeShade,
  getSunPosition,
  shadowLength,
  treeShadow,
} from "../src/lib/shade";

const CHINATOWN = { lat: 42.3515, lng: -71.0605 };
let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name} ${detail}`);
    failures += 1;
  }
}

function bearingBetween(from: [number, number], to: [number, number]) {
  return (turf.bearing(turf.point(from), turf.point(to)) + 360) % 360;
}

console.log("\nSolar position (June solstice, Boston)");
{
  // Solar noon in Boston in June is ~12:52 EDT = 16:52 UTC.
  const solarNoon = new Date("2027-06-21T16:52:00Z");
  const sun = getSunPosition(solarNoon, CHINATOWN.lat, CHINATOWN.lng);
  const altitudeDeg = sun.altitudeDeg;

  // Max altitude = 90 - latitude + 23.44 = 90 - 42.35 + 23.44 ≈ 71.1°
  check(
    "solstice noon altitude is ~71°",
    altitudeDeg > 69 && altitudeDeg < 73,
    `(got ${altitudeDeg.toFixed(1)}°)`,
  );

  // Sun due south at solar noon => shadows point due north (bearing ~0/360).
  const shadowBearing = antiSolarBearing(sun.azimuthDeg);
  const northish = shadowBearing < 8 || shadowBearing > 352;
  check(
    "shadows point NORTH at solar noon",
    northish,
    `(got bearing ${shadowBearing.toFixed(1)}°)`,
  );
}

console.log("\nShadow direction through the day");
{
  // Morning sun in the east => shadows fall to the WEST (bearing ~270).
  const morning = new Date("2027-06-21T13:00:00Z"); // 9am EDT
  const morningBearing = antiSolarBearing(getSunPosition(morning, CHINATOWN.lat, CHINATOWN.lng).azimuthDeg);
  check(
    "9am shadows point WEST-ish",
    morningBearing > 225 && morningBearing < 315,
    `(got ${morningBearing.toFixed(1)}°)`,
  );

  // Afternoon sun in the west => shadows fall to the EAST (bearing ~90).
  const afternoon = new Date("2027-06-21T21:00:00Z"); // 5pm EDT
  const afternoonBearing = antiSolarBearing(getSunPosition(afternoon, CHINATOWN.lat, CHINATOWN.lng).azimuthDeg);
  check(
    "5pm shadows point EAST-ish",
    afternoonBearing > 45 && afternoonBearing < 135,
    `(got ${afternoonBearing.toFixed(1)}°)`,
  );
}

console.log("\nShadow length");
{
  // At 45° altitude, shadow length equals object height.
  const len = shadowLength(10, 45);
  check("L = h at 45° altitude", len != null && Math.abs(len - 10) < 0.01, `(got ${len})`);

  // At 60°, L = h/tan(60°) = 10/1.732 ≈ 5.77 m.
  const sixty = shadowLength(10, 60);
  check("L = h/tan(60°) ≈ 5.77", sixty != null && Math.abs(sixty - 5.7735) < 0.01, `(got ${sixty})`);

  // Lower sun => longer shadow.
  const low = shadowLength(10, 15);
  const high = shadowLength(10, 60);
  check("lower sun casts a longer shadow", (low ?? 0) > (high ?? 0), `(${low} vs ${high})`);

  // Sun at or below the horizon => no shadow geometry.
  check("no shadow at altitude 0", shadowLength(10, 0) === null);
  check("no shadow below horizon", shadowLength(10, -12) === null);

  // Very low sun must be clamped, not run off to infinity.
  const grazing = shadowLength(10, 0.05);
  check("grazing sun is clamped", grazing != null && grazing <= 500, `(got ${grazing})`);
}

console.log("\nBuilding shadow geometry");
{
  const solarNoon = new Date("2027-06-21T16:52:00Z");
  const sun = getSunPosition(solarNoon, CHINATOWN.lat, CHINATOWN.lng);
  const footprint = turf.polygon([
    [
      [-71.0605, 42.3515],
      [-71.0603, 42.3515],
      [-71.0603, 42.3517],
      [-71.0605, 42.3517],
      [-71.0605, 42.3515],
    ],
  ]);

  const shadow = buildingShadow(footprint, 30, sun);
  check("building casts a shadow", shadow != null);

  if (shadow) {
    const shadowArea = turf.area(shadow);
    const footprintArea = turf.area(footprint);
    check(
      "shadow is larger than the footprint",
      shadowArea > footprintArea,
      `(${Math.round(shadowArea)} vs ${Math.round(footprintArea)} m²)`,
    );

    // The shadow's centroid must sit north of the building at solar noon.
    const fc = turf.centroid(footprint).geometry.coordinates as [number, number];
    const sc = turf.centroid(shadow).geometry.coordinates as [number, number];
    check("shadow centroid is NORTH of the building", sc[1] > fc[1], `(${sc[1]} vs ${fc[1]})`);

    const offsetBearing = bearingBetween(fc, sc);
    check(
      "offset bearing is northward",
      offsetBearing < 15 || offsetBearing > 345,
      `(got ${offsetBearing.toFixed(1)}°)`,
    );
  }

  // A taller building must cast a longer shadow.
  const short = buildingShadow(footprint, 10, sun);
  const tall = buildingShadow(footprint, 60, sun);
  check(
    "taller building casts a bigger shadow",
    short != null && tall != null && turf.area(tall) > turf.area(short),
  );
}

console.log("\nTree shadow geometry");
{
  const afternoon = new Date("2027-06-21T21:00:00Z");
  const sun = getSunPosition(afternoon, CHINATOWN.lat, CHINATOWN.lng);
  const tree = turf.point([-71.0605, 42.3515]);

  const shadow = treeShadow(tree, 8, 4, sun);
  check("tree casts a shadow", shadow != null);

  if (shadow) {
    // Capsule must be longer than a bare crown circle.
    const crownArea = Math.PI * 4 * 4;
    check(
      "tree shadow is bigger than the crown alone",
      turf.area(shadow) > crownArea,
      `(${Math.round(turf.area(shadow))} vs ${Math.round(crownArea)} m²)`,
    );

    const tc = tree.geometry.coordinates as [number, number];
    const sc = turf.centroid(shadow).geometry.coordinates as [number, number];
    check("afternoon tree shadow falls EAST of the tree", sc[0] > tc[0], `(${sc[0]} vs ${tc[0]})`);
  }

  const bigCrown = treeShadow(tree, 8, 8, sun);
  const smallCrown = treeShadow(tree, 8, 2, sun);
  check(
    "bigger crown casts a bigger shadow",
    bigCrown != null && smallCrown != null && turf.area(bigCrown) > turf.area(smallCrown),
  );
}

console.log("\ncomputeShade end to end");
{
  const buildings = turf.featureCollection([
    turf.polygon(
      [
        [
          [-71.0605, 42.3515],
          [-71.0603, 42.3515],
          [-71.0603, 42.3517],
          [-71.0605, 42.3517],
          [-71.0605, 42.3515],
        ],
      ],
      { height_m: 30 },
    ),
    // No usable height — must be skipped, not guessed tall (§14).
    turf.polygon(
      [
        [
          [-71.0600, 42.3515],
          [-71.0598, 42.3515],
          [-71.0598, 42.3517],
          [-71.0600, 42.3517],
          [-71.0600, 42.3515],
        ],
      ],
      { height_m: null } as unknown as { height_m: number },
    ),
  ]);
  const trees = turf.featureCollection([
    turf.point([-71.0604, 42.3514], { crown_m: 6 }),
    turf.point([-71.0602, 42.3513], {}),
  ]);

  const noon = computeShade(
    { buildings, trees, buildingHeightProperty: "height_m", treeCrownRadiusProperty: "crown_m" },
    new Date("2027-06-21T16:52:00Z"),
    CHINATOWN,
  );
  check("daytime: building shade produced", noon.buildingShade != null);
  check("daytime: tree shade produced", noon.treeShade != null);
  check("daytime: not marked below horizon", noon.belowHorizon === false);
  check(
    "building with no height is skipped, not guessed",
    noon.skippedBuildings === 1,
    `(got ${noon.skippedBuildings})`,
  );

  // §6 step 2: below the horizon the whole area is shade; return early.
  const night = computeShade(
    { buildings, trees, buildingHeightProperty: "height_m", treeCrownRadiusProperty: "crown_m" },
    new Date("2027-06-21T05:00:00Z"), // 1am EDT
    CHINATOWN,
  );
  check("night: flagged below horizon", night.belowHorizon === true);
  check("night: no geometry emitted", night.buildingShade == null && night.treeShade == null);
}

console.log(
  failures === 0
    ? "\nAll shade geometry checks passed.\n"
    : `\n${failures} shade geometry check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
