/** Chinatown bounding box from SPEC §5. All extracts are clipped to this. */
export const CHINATOWN_BBOX = {
  west: -71.066,
  south: 42.348,
  east: -71.055,
  north: 42.355,
} as const;

export const CHINATOWN_CENTRE = {
  lat: (CHINATOWN_BBOX.south + CHINATOWN_BBOX.north) / 2,
  lng: (CHINATOWN_BBOX.west + CHINATOWN_BBOX.east) / 2,
} as const;

export const CHINATOWN_BBOX_ARRAY: [number, number, number, number] = [
  CHINATOWN_BBOX.west,
  CHINATOWN_BBOX.south,
  CHINATOWN_BBOX.east,
  CHINATOWN_BBOX.north,
];
