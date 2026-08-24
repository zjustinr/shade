import type { Reading, Site } from "@/db/schema";

export type ReadingWithSite = { reading: Reading; site: Site | null };

const CSV_COLUMNS = [
  "reading_id",
  "site_code",
  "site_name_en",
  "site_type",
  "is_control",
  "observer",
  "recorded_at",
  "lat",
  "lng",
  "gps_accuracy_m",
  "surface_type",
  "sun_temp_f",
  "shade_temp_f",
  "delta_f",
  "air_temp_f",
  "shade_source",
  "photo_url",
  "notes",
  "flagged",
  "flag_reason",
] as const;

function csvCell(value: unknown): string {
  if (value == null) return "";
  // Numbers and booleans are emitted bare. Quoting a negative longitude or a
  // negative delta as text would corrupt the two fields this dataset most
  // depends on, and neither type can carry a spreadsheet formula.
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const str = String(value);
  // Guard against CSV injection when a text field is opened in a spreadsheet:
  // prefix formula-leading characters so they're treated as text.
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: ReadingWithSite[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const { reading, site } of rows) {
    lines.push(
      [
        reading.id,
        site?.code,
        site?.nameEn,
        site?.siteType,
        site?.isControl,
        reading.observer,
        reading.recordedAt.toISOString(),
        reading.lat,
        reading.lng,
        reading.gpsAccuracyM,
        reading.surfaceType,
        reading.sunTempF,
        reading.shadeTempF,
        reading.deltaF,
        reading.airTempF,
        reading.shadeSource,
        reading.photoUrl,
        reading.notes,
        reading.flagged,
        reading.flagReason,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function toGeoJson(rows: ReadingWithSite[]) {
  return {
    type: "FeatureCollection" as const,
    features: rows
      // A reading with no coordinates has nothing to place on a map. Fall
      // back to the site's planned position when device GPS was unavailable.
      .map(({ reading, site }) => {
        const lng = reading.lng ?? site?.lng;
        const lat = reading.lat ?? site?.lat;
        if (lng == null || lat == null) return null;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: {
            reading_id: reading.id,
            site_code: site?.code ?? null,
            site_name_en: site?.nameEn ?? null,
            site_type: site?.siteType ?? null,
            is_control: site?.isControl ?? null,
            observer: reading.observer,
            recorded_at: reading.recordedAt.toISOString(),
            position_source: reading.lat != null ? "device_gps" : "planned_site",
            gps_accuracy_m: reading.gpsAccuracyM,
            surface_type: reading.surfaceType,
            sun_temp_f: reading.sunTempF,
            shade_temp_f: reading.shadeTempF,
            delta_f: reading.deltaF,
            air_temp_f: reading.airTempF,
            shade_source: reading.shadeSource,
            photo_url: reading.photoUrl,
            notes: reading.notes,
            flagged: reading.flagged,
            flag_reason: reading.flagReason,
          },
        };
      })
      .filter((f) => f !== null),
  };
}
