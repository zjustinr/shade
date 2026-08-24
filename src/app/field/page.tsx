"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cacheCoverage, cacheSites, getCachedCoverage, getCachedSites } from "@/lib/offline-db";
import type { CachedSite, SiteCoverage } from "@/lib/offline-db";
import { formatDistance, haversineMeters } from "@/lib/geo";

type SiteStatus = "not_started" | "done" | "flagged";

export default function FieldSiteListPage() {
  const [sites, setSites] = useState<CachedSite[]>([]);
  const [coverage, setCoverage] = useState<SiteCoverage[]>([]);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const cached = await getCachedSites();
      if (cached.length) setSites(cached);
      const cachedCoverage = await getCachedCoverage();
      if (cachedCoverage.length) setCoverage(cachedCoverage);

      try {
        const res = await fetch("/api/sites");
        if (res.ok) {
          const fresh: CachedSite[] = await res.json();
          setSites(fresh);
          await cacheSites(fresh);
        }
      } catch {
        // offline — cached sites (if any) already rendered above
      }

      try {
        const res = await fetch("/api/coverage");
        if (res.ok) {
          const fresh: SiteCoverage[] = await res.json();
          setCoverage(fresh);
          await cacheCoverage(fresh);
        }
      } catch {
        // offline — cached coverage (if any) already rendered above
      }
    })();
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      queueMicrotask(() => setLocationError("No GPS on this device."));
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPosition(pos),
      () => setLocationError("Location unavailable — showing unsorted list."),
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const coverageBySite = useMemo(() => {
    const map = new Map<number, SiteCoverage>();
    for (const c of coverage) map.set(c.siteId, c);
    return map;
  }, [coverage]);

  const sorted = useMemo(() => {
    const withDistance = sites.map((site) => {
      const distance = position
        ? haversineMeters(
            { lat: position.coords.latitude, lng: position.coords.longitude },
            { lat: site.lat, lng: site.lng },
          )
        : null;
      const cov = coverageBySite.get(site.id);
      const status: SiteStatus = cov?.flagged ? "flagged" : cov?.hasReading ? "done" : "not_started";
      return { site, distance, status };
    });
    return withDistance.sort((a, b) => {
      if (a.distance == null || b.distance == null) return 0;
      return a.distance - b.distance;
    });
  }, [sites, position, coverageBySite]);

  const doneCount = sorted.filter((s) => s.status !== "not_started").length;

  return (
    <div className="mx-auto max-w-xl px-4 py-4">
      <div className="mb-4 rounded-xl bg-neutral-900 px-4 py-3 text-white hc:bg-black hc:border hc:border-yellow-400">
        <p className="text-2xl font-bold">
          {doneCount} of {sorted.length} sites complete
        </p>
        {locationError ? <p className="mt-1 text-sm text-neutral-300">{locationError}</p> : null}
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map(({ site, distance, status }) => (
          <li key={site.id}>
            <Link
              href={`/field/${site.code}`}
              className="flex min-h-[56px] items-center justify-between gap-3 rounded-lg border border-neutral-200 px-4 py-3 active:bg-neutral-50 hc:border-yellow-400 hc:active:bg-neutral-900"
            >
              <div>
                <p className="font-semibold">
                  {site.code} · {site.nameEn}
                  {site.isControl ? " (control)" : ""}
                </p>
                <p className="text-sm text-neutral-600 hc:text-yellow-200">
                  {distance != null ? formatDistance(distance) : "distance unknown"} ·{" "}
                  {site.siteType.replace("_", " ")}
                </p>
              </div>
              <StatusBadge status={status} />
            </Link>
          </li>
        ))}
      </ul>

      {sorted.length === 0 ? (
        <p className="mt-8 text-center text-neutral-500">
          No sites loaded yet. Connect once to download the site list — after that it works
          offline.
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: SiteStatus }) {
  const styles: Record<SiteStatus, string> = {
    not_started: "bg-neutral-200 text-neutral-700",
    done: "bg-green-100 text-green-800",
    flagged: "bg-amber-100 text-amber-800",
  };
  const labels: Record<SiteStatus, string> = {
    not_started: "Not started",
    done: "Done",
    flagged: "Flagged",
  };
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium hc:border hc:border-current hc:bg-black ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
