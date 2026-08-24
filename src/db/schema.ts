import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const siteTypeValues = [
  "bus_stop",
  "senior_housing",
  "playground",
  "crosswalk",
  "plaza",
  "park",
  "school",
  "other",
] as const;

export const surfaceTypeValues = ["asphalt", "concrete", "brick", "other"] as const;

export const shadeSourceValues = [
  "tree",
  "awning",
  "building",
  "bus_shelter",
  "other",
] as const;

export const flagReasonValues = [
  "negative_delta",
  "implausible_delta",
  "manual",
] as const;

// The 60 planned measurement locations, seeded from a JSON fixture.
export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // 'CT-01'
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh"),
  nameVi: text("name_vi"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  siteType: text("site_type").notNull(), // see siteTypeValues
  notes: text("notes"),
  isControl: boolean("is_control").notNull().default(false), // Boston Common comparison points
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One paired sun/shade observation.
export const readings = pgTable(
  "readings",
  {
    id: uuid("id").primaryKey(), // generated client-side so offline writes are idempotent
    siteId: integer("site_id").references(() => sites.id),
    observer: text("observer").notNull(), // first name only, never full name
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), // device time at capture, NOT server time
    lat: doublePrecision("lat"), // actual GPS at capture; may differ from site
    lng: doublePrecision("lng"),
    gpsAccuracyM: real("gps_accuracy_m"),

    surfaceType: text("surface_type").notNull(),
    sunTempF: real("sun_temp_f").notNull(),
    shadeTempF: real("shade_temp_f").notNull(),
    airTempF: real("air_temp_f"),
    shadeSource: text("shade_source").notNull(),
    deltaF: real("delta_f").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`(sun_temp_f - shade_temp_f)`,
    ),

    photoUrl: text("photo_url"),
    notes: text("notes"),

    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("readings_site_idx").on(table.siteId),
    index("readings_time_idx").on(table.recordedAt),
    // Defense-in-depth: the API enforces these with Zod before insert
    // (see src/lib/validation.ts); this guards direct DB writes too.
    check("readings_sun_temp_range", sql`${table.sunTempF} BETWEEN 20 AND 200`),
    check("readings_shade_temp_range", sql`${table.shadeTempF} BETWEEN 20 AND 200`),
  ],
);

// The physical installations the project builds.
export const coolingCorners = pgTable("cooling_corners", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh"),
  nameVi: text("name_vi"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  descriptionEn: text("description_en"),
  descriptionZh: text("description_zh"),
  descriptionVi: text("description_vi"),
  hasSeating: boolean("has_seating").default(false),
  installedOn: date("installed_on"),
  photoUrl: text("photo_url"),
});

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Reading = typeof readings.$inferSelect;
export type NewReading = typeof readings.$inferInsert;
export type CoolingCorner = typeof coolingCorners.$inferSelect;
export type NewCoolingCorner = typeof coolingCorners.$inferInsert;
