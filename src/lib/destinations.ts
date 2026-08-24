/**
 * Everyday destinations people walk to in Chinatown.
 *
 * A positioning note, because SPEC §0 makes it load-bearing: this is a list
 * of places to walk TO, so the map can answer "which way there is shaded".
 * It is deliberately NOT a cooling-resources directory. Nothing here records
 * whether a building is air-conditioned, whether it is open as a refuge, or
 * what its hours are — that is the City's map, and the app links out to it
 * rather than reproducing it. Keep it that way: the moment this becomes a
 * "where can I cool off" index it duplicates an existing City service.
 */

export const DESTINATION_CATEGORIES = [
  "pharmacy",
  "library",
  "hospital",
  "health_center",
  "public_housing",
  "restaurant",
  "park",
] as const;

export type DestinationCategory = (typeof DESTINATION_CATEGORIES)[number];

export type Destination = {
  id: string;
  category: DestinationCategory;
  name: string;
  address: string | null;
  lng: number;
  lat: number;
};

/** Marker colours, distinct from the shade fills and the reading dots. */
export const CATEGORY_COLOURS: Record<DestinationCategory, string> = {
  pharmacy: "#0891b2",
  library: "#7c3aed",
  hospital: "#be123c",
  health_center: "#db2777",
  public_housing: "#a16207",
  restaurant: "#ea580c",
  park: "#15803d",
};

/** Message-catalog keys under `destinations.category`. */
export function categoryKey(category: DestinationCategory): string {
  return `category.${category}`;
}
