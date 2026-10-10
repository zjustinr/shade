import { z } from "zod";
import {
  flagReasonValues,
  shadeSourceValues,
  siteTypeValues,
  surfaceTypeValues,
  windFromValues,
} from "@/db/schema";

/**
 * §4 validation rules:
 * - sun_temp_f and shade_temp_f both required (an unpaired reading is
 *   meaningless and must not enter the dataset) and in [20, 200].
 * - delta_f is normally positive but a negative delta is accepted and
 *   auto-flagged, never rejected — anomalies are data.
 * - delta_f > 60 is flagged as implausible but still accepted.
 * - wind is optional. When given, it is in mph, 0-120 for the mean and
 *   0-150 for a gust. A gust below the mean is physically impossible, so it
 *   is flagged for review — but, like every anomaly here, saved: the
 *   temperature pair on the same reading is still good data.
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

  windMph: z.number().min(0).max(120).nullable().optional(),
  windGustMph: z.number().min(0).max(150).nullable().optional(),
  windFrom: z.enum(windFromValues).nullable().optional(),

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

/**
 * Everything about a reading that warrants a second look, as one verdict.
 * Temperature anomalies take precedence — they are the dataset's headline
 * numbers — and a wind anomaly is reported only when the temperatures are
 * fine, so a reading never carries two reasons.
 */
export function classifyReading(input: {
  sunTempF: number;
  shadeTempF: number;
  windMph?: number | null;
  windGustMph?: number | null;
}): ReadingFlag {
  const delta = classifyDelta(input.sunTempF, input.shadeTempF);
  if (delta.flagged) return delta;

  const { windMph, windGustMph } = input;
  if (windMph != null && windGustMph != null && windGustMph < windMph) {
    return { flagged: true, flagReason: "gust_below_mean" };
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
