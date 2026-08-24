export type ShadeSlot = {
  time: string; // "HH:MM" local Boston wall clock
  belowHorizon: boolean;
  sunAltitudeDeg: number;
};

export type ShadeDate = {
  dateKey: string;
  date: string; // ISO date the slots were computed for
  slots: ShadeSlot[];
};

export type ShadeIndex = {
  generatedAt: string;
  stepMinutes: number;
  startHour: number;
  endHour: number;
  timezone: string;
  buildingsTotal: number;
  buildingsSkippedNoHeight: number;
  treesTotal: number;
  dates: ShadeDate[];
};

/** Labels for the four precomputed dates, keyed as the build script emits them. */
export const SHADE_DATE_LABELS: Record<string, string> = {
  "spring-equinox": "Spring equinox",
  "summer-solstice": "Summer solstice",
  "autumn-equinox": "Autumn equinox",
  "winter-solstice": "Winter solstice",
};

/**
 * Picks the precomputed date whose sun angles are closest to the requested
 * one. The model ships four representative dates (§6), so any other date
 * snaps to the nearest of them by day-of-year distance, wrapping at the
 * year boundary.
 */
export function nearestShadeDate(target: Date, index: ShadeIndex): ShadeDate {
  const targetDay = dayOfYear(target);
  let best = index.dates[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of index.dates) {
    const candidateDay = dayOfYear(new Date(`${candidate.date}T12:00:00Z`));
    const raw = Math.abs(candidateDay - targetDay);
    const distance = Math.min(raw, 365 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

/** Snaps a wall-clock time to the nearest precomputed half-hour slot. */
export function nearestSlot(minutesFromMidnight: number, slots: ShadeSlot[]): ShadeSlot {
  let best = slots[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const [h, m] = slot.time.split(":").map(Number);
    const distance = Math.abs(h * 60 + m - minutesFromMidnight);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return best;
}

export function slotFileName(slot: ShadeSlot): string {
  return `${slot.time.replace(":", "")}.geojson`;
}

export function formatSlotLabel(time: string, locale: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
