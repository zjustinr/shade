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

/**
 * The area the shade, network, wind and destination data now cover: Back Bay
 * (west to Massachusetts Ave), Downtown and the Financial District (east to the
 * waterfront), with Chinatown in the middle. About 5.5x Chinatown's own box.
 * CHINATOWN_BBOX stays as the field-campaign area and the print-sheet extent.
 */
export const STUDY_AREA_BBOX = {
  west: -71.0885,
  south: 42.3455,
  east: -71.0505,
  north: 42.3615,
} as const;

export const STUDY_AREA_CENTRE = {
  lat: (STUDY_AREA_BBOX.south + STUDY_AREA_BBOX.north) / 2,
  lng: (STUDY_AREA_BBOX.west + STUDY_AREA_BBOX.east) / 2,
} as const;

export const STUDY_AREA_BBOX_ARRAY: [number, number, number, number] = [
  STUDY_AREA_BBOX.west,
  STUDY_AREA_BBOX.south,
  STUDY_AREA_BBOX.east,
  STUDY_AREA_BBOX.north,
];
