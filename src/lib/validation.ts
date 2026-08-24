import { z } from "zod";
import {
  flagReasonValues,
  shadeSourceValues,
  siteTypeValues,
  surfaceTypeValues,
} from "@/db/schema";

/**
 * §4 validation rules:
 * - sun_temp_f and shade_temp_f both required (an unpaired reading is
 *   meaningless and must not enter the dataset) and in [20, 200].
 * - delta_f is normally positive but a negative delta is accepted and
 *   auto-flagged, never rejected — anomalies are data.
 * - delta_f > 60 is flagged as implausible but still accepted.
 */
const TEMP_MIN = 20;
const TEMP_MAX = 200;
const IMPLAUSIBLE_DELTA = 60;

export const readingInputSchema = z.object({
  id: z.uuid(),
  siteId: z.number().int().positive().nullable(),
  observer: z
    .string()
    .trim()
    .min(1, "Observer first name is required.")
    .max(50, "Use a first name only."),
  recordedAt: z.iso.datetime({ offset: true }),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  gpsAccuracyM: z.number().nonnegative().nullable().optional(),

  surfaceType: z.enum(surfaceTypeValues),
  sunTempF: z.number().min(TEMP_MIN).max(TEMP_MAX),
  shadeTempF: z.number().min(TEMP_MIN).max(TEMP_MAX),
  airTempF: z.number().min(TEMP_MIN).max(TEMP_MAX).nullable().optional(),
  shadeSource: z.enum(shadeSourceValues),

  photoUrl: z.url().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type ReadingInput = z.infer<typeof readingInputSchema>;

export type ReadingFlag = {
  flagged: boolean;
  flagReason: (typeof flagReasonValues)[number] | null;
};

/** Never rejects on the delta — only classifies it for review. */
export function classifyDelta(sunTempF: number, shadeTempF: number): ReadingFlag {
  const delta = sunTempF - shadeTempF;
  if (delta < 0) {
    return { flagged: true, flagReason: "negative_delta" };
  }
  if (delta > IMPLAUSIBLE_DELTA) {
    return { flagged: true, flagReason: "implausible_delta" };
  }
  return { flagged: false, flagReason: null };
}

export const siteInputSchema = z.object({
  code: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  nameZh: z.string().trim().nullable().optional(),
  nameVi: z.string().trim().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  siteType: z.enum(siteTypeValues),
  notes: z.string().nullable().optional(),
  isControl: z.boolean().optional().default(false),
});

export type SiteInput = z.infer<typeof siteInputSchema>;

export const flagUpdateSchema = z.object({
  flagged: z.boolean(),
  flagReason: z.enum(flagReasonValues).nullable().optional(),
});
