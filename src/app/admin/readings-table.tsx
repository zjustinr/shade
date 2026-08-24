"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type AdminReadingRow = {
  id: string;
  siteCode: string | null;
  siteName: string | null;
  observer: string;
  recordedAt: string;
  surfaceType: string;
  shadeSource: string;
  sunTempF: number;
  shadeTempF: number;
  deltaF: number | null;
  photoUrl: string | null;
  notes: string | null;
  flagged: boolean;
  flagReason: string | null;
};

type SortKey = "recordedAt" | "siteCode" | "deltaF";
type FilterMode = "all" | "flagged" | "unflagged";

export function ReadingsTable({ rows }: { rows: AdminReadingRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("recordedAt");
  const [ascending, setAscending] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const visible = useMemo(() => {
    const filtered = rows.filter((r) =>
      filter === "all" ? true : filter === "flagged" ? r.flagged : !r.flagged,
    );
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "deltaF") return (a.deltaF ?? 0) - (b.deltaF ?? 0);
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return av.localeCompare(bv);
    });
    return ascending ? sorted : sorted.reverse();
  }, [rows, sortKey, ascending, filter]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending((v) => !v);
    else {
      setSortKey(key);
      setAscending(false);
    }
  }

  async function toggleFlag(row: AdminReadingRow) {
    await fetch(`/api/admin/readings/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flagged: !row.flagged,
        flagReason: !row.flagged ? "manual" : null,
      }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["all", "flagged", "unflagged"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setFilter(mode)}
            aria-pressed={filter === mode}
            className={`min-h-[44px] rounded-lg border px-4 py-2 text-sm font-medium capitalize ${
              filter === mode ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
            }`}
          >
            {mode}
          </button>
        ))}
        <span className="text-sm text-neutral-600">
          {visible.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left">
              <SortHeader label="Site" active={sortKey === "siteCode"} onClick={() => toggleSort("siteCode")} />
              <SortHeader label="Recorded" active={sortKey === "recordedAt"} onClick={() => toggleSort("recordedAt")} />
              <th className="py-2 font-medium">Observer</th>
              <th className="py-2 text-right font-medium">Sun</th>
              <th className="py-2 text-right font-medium">Shade</th>
              <SortHeader label="Δ°F" align="right" active={sortKey === "deltaF"} onClick={() => toggleSort("deltaF")} />
              <th className="py-2 font-medium">Surface</th>
              <th className="py-2 font-medium">Shade source</th>
              <th className="py-2 font-medium">Photo</th>
              <th className="py-2 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-neutral-100 ${row.flagged ? "bg-amber-50" : ""}`}
              >
                <td className="py-2">
                  {row.siteCode ?? "—"}
                  {row.siteName ? <span className="block text-xs text-neutral-500">{row.siteName}</span> : null}
                </td>
                <td className="py-2 whitespace-nowrap">{new Date(row.recordedAt).toLocaleString()}</td>
                <td className="py-2">{row.observer}</td>
                <td className="py-2 text-right tabular-nums">{row.sunTempF}</td>
                <td className="py-2 text-right tabular-nums">{row.shadeTempF}</td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {row.deltaF?.toFixed(1) ?? "—"}
                </td>
                <td className="py-2 capitalize">{row.surfaceType}</td>
                <td className="py-2 capitalize">{row.shadeSource.replace("_", " ")}</td>
                <td className="py-2">
                  {row.photoUrl ? (
                    <a href={row.photoUrl} target="_blank" rel="noreferrer" className="underline">
                      View
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => toggleFlag(row)}
                    disabled={pending}
                    className="min-h-[36px] rounded border border-neutral-300 px-2 py-1 text-xs font-medium"
                  >
                    {row.flagged ? `Unflag (${row.flagReason ?? "flagged"})` : "Flag"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 text-neutral-600">No readings match this filter.</p>
      ) : null}
    </div>
  );
}

function SortHeader({
  label,
  active,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`py-2 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={onClick} className="min-h-[36px] underline-offset-2 hover:underline">
        {label}
        {active ? " ↕" : ""}
      </button>
    </th>
  );
}
