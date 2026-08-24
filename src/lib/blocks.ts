import { CHINATOWN_BBOX } from "./chinatown";

/**
 * Named blocks for the printable sheets (§7 `/print/[block]`).
 *
 * These extents are drawn from the Chinatown bounding box in SPEC §5 and are
 * APPROXIMATE — like the sites fixture, real block boundaries are something
 * the crew should walk and confirm. Names are English-only here; the zh-Hant
 * and vi names belong with the community translator alongside the site
 * names, not machine-guessed for a street sign.
 */
export type Block = {
  code: string;
  nameEn: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
};

export const BLOCKS: Block[] = [
  {
    code: "north",
    nameEn: "North Chinatown (approx.)",
    bbox: [-71.066, 42.3515, -71.0605, 42.355],
  },
  {
    code: "east",
    nameEn: "East Chinatown (approx.)",
    bbox: [-71.0605, 42.3515, -71.055, 42.355],
  },
  {
    code: "south",
    nameEn: "South Chinatown (approx.)",
    bbox: [-71.066, 42.348, -71.0605, 42.3515],
  },
  {
    code: "southeast",
    nameEn: "Southeast Chinatown (approx.)",
    bbox: [-71.0605, 42.348, -71.055, 42.3515],
  },
  {
    code: "all",
    nameEn: "All of Chinatown",
    bbox: [
      CHINATOWN_BBOX.west,
      CHINATOWN_BBOX.south,
      CHINATOWN_BBOX.east,
      CHINATOWN_BBOX.north,
    ],
  },
];

export function findBlock(code: string): Block | undefined {
  return BLOCKS.find((b) => b.code === code);
}

export function blockCentre(block: Block): { lat: number; lng: number } {
  const [west, south, east, north] = block.bbox;
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}
