import type { ReadingWithSite } from "@/lib/export";

export type GroupedStat = { key: string; count: number; meanDelta: number };

function meanDelta(rows: ReadingWithSite[]): number {
  const deltas = rows
    .map(({ reading }) => reading.deltaF)
    .filter((d): d is number => d != null);
  if (deltas.length === 0) return 0;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

function groupBy(
  rows: ReadingWithSite[],
  keyFn: (row: ReadingWithSite) => string,
): GroupedStat[] {
  const groups = new Map<string, ReadingWithSite[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .map(([key, groupRows]) => ({
      key,
      count: groupRows.length,
      meanDelta: meanDelta(groupRows),
    }))
    .sort((a, b) => b.meanDelta - a.meanDelta);
}

export function statsByShadeSource(rows: ReadingWithSite[]): GroupedStat[] {
  return groupBy(rows, ({ reading }) => reading.shadeSource);
}

export function statsBySurfaceType(rows: ReadingWithSite[]): GroupedStat[] {
  return groupBy(rows, ({ reading }) => reading.surfaceType);
}

export function statsByHour(rows: ReadingWithSite[]): GroupedStat[] {
  return groupBy(rows, ({ reading }) => String(reading.recordedAt.getHours()).padStart(2, "0")).sort(
    (a, b) => a.key.localeCompare(b.key),
  );
}
