import { db, sites } from "@/db";
import { getReadingsWithSites } from "@/lib/readings-query";
import { statsByHour, statsByShadeSource, statsBySurfaceType } from "@/lib/stats";
import { ReadingsTable } from "./readings-table";
import type { GroupedStat } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [allSites, rows] = await Promise.all([
    db.select().from(sites).orderBy(sites.code),
    getReadingsWithSites(),
  ]);

  const readingsBySite = new Map<number, number>();
  const flaggedBySite = new Map<number, number>();
  for (const { reading } of rows) {
    if (reading.siteId == null) continue;
    readingsBySite.set(reading.siteId, (readingsBySite.get(reading.siteId) ?? 0) + 1);
    if (reading.flagged) {
      flaggedBySite.set(reading.siteId, (flaggedBySite.get(reading.siteId) ?? 0) + 1);
    }
  }

  const doneCount = allSites.filter((s) => readingsBySite.has(s.id)).length;
  const flaggedCount = rows.filter((r) => r.reading.flagged).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Cool Corners — Admin</h1>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Sites with a reading" value={`${doneCount} / ${allSites.length}`} />
        <StatCard label="Readings total" value={String(rows.length)} />
        <StatCard label="Flagged for review" value={String(flaggedCount)} />
      </section>

      {/* File downloads, not page navigations — next/link would attempt a
          client-side transition and never trigger the download. */}
      <section className="mt-6 flex flex-wrap gap-3">
        <a
          href="/api/admin/export/csv"
          download
          className="min-h-[44px] rounded-lg bg-neutral-900 px-5 py-2.5 font-semibold text-white"
        >
          Export CSV
        </a>
        <a
          href="/api/admin/export/geojson"
          download
          className="min-h-[44px] rounded-lg border border-neutral-300 px-5 py-2.5 font-semibold"
        >
          Export GeoJSON
        </a>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Coverage</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {allSites.map((site) => {
            const count = readingsBySite.get(site.id) ?? 0;
            const flagged = flaggedBySite.get(site.id) ?? 0;
            const tone =
              count === 0
                ? "border-neutral-200 bg-neutral-50"
                : flagged > 0
                  ? "border-amber-300 bg-amber-50"
                  : "border-green-300 bg-green-50";
            return (
              <li key={site.id} className={`rounded-lg border px-3 py-2 ${tone}`}>
                <p className="font-medium">
                  {site.code} · {site.nameEn}
                  {site.isControl ? " (control)" : ""}
                </p>
                <p className="text-sm text-neutral-600">
                  {count === 0
                    ? "No readings"
                    : `${count} reading${count === 1 ? "" : "s"}${flagged ? ` · ${flagged} flagged` : ""}`}
                </p>
              </li>
            );
          })}
        </ul>
        {allSites.length === 0 ? (
          <p className="text-neutral-600">
            No sites seeded yet. Run <code>npm run seed:sites</code>.
          </p>
        ) : null}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <StatTable title="Mean delta by shade source" stats={statsByShadeSource(rows)} />
        <StatTable title="Mean delta by surface" stats={statsBySurfaceType(rows)} />
        <StatTable title="Mean delta by hour" stats={statsByHour(rows)} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Readings</h2>
        <ReadingsTable
          rows={rows.map(({ reading, site }) => ({
            id: reading.id,
            siteCode: site?.code ?? null,
            siteName: site?.nameEn ?? null,
            observer: reading.observer,
            recordedAt: reading.recordedAt.toISOString(),
            surfaceType: reading.surfaceType,
            shadeSource: reading.shadeSource,
            sunTempF: reading.sunTempF,
            shadeTempF: reading.shadeTempF,
            deltaF: reading.deltaF,
            photoUrl: reading.photoUrl,
            notes: reading.notes,
            flagged: reading.flagged,
            flagReason: reading.flagReason,
          }))}
        />
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 px-4 py-3">
      <p className="text-sm text-neutral-600">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function StatTable({ title, stats }: { title: string; stats: GroupedStat[] }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      {stats.length === 0 ? (
        <p className="text-sm text-neutral-500">No readings yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left">
              <th className="py-1 font-medium">Group</th>
              <th className="py-1 text-right font-medium">n</th>
              <th className="py-1 text-right font-medium">Mean Δ°F</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.key} className="border-b border-neutral-100">
                <td className="py-1 capitalize">{s.key.replace("_", " ")}</td>
                <td className="py-1 text-right tabular-nums">{s.count}</td>
                <td className="py-1 text-right tabular-nums">{s.meanDelta.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
