"use client";

import { useEffect, useState } from "react";
import type { WalkNetwork } from "@/lib/network";
import type { Destination } from "@/lib/destinations";

type RouteData = {
  network: WalkNetwork | null;
  destinations: Destination[];
  loading: boolean;
  failed: boolean;
};

/**
 * Loads the walking network and destination list, once, on demand.
 *
 * Both are static files the service worker caches, so a second visit — or a
 * visit with no signal — gets them without a request. They are fetched only
 * when the planner is opened rather than with the map, because most visits
 * are someone looking at the shade layer and never routing.
 */
export function useRouteData(enabled: boolean): RouteData {
  const [network, setNetwork] = useState<WalkNetwork | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [failed, setFailed] = useState(false);

  // Derived, not stored: "loading" is exactly "asked for, not here yet, not
  // given up". Keeping it in state would mean syncing it in the effect.
  const loading = enabled && network === null && !failed;

  useEffect(() => {
    if (!enabled || network) return;
    let cancelled = false;

    Promise.all([
      fetch("/data/network.json").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/data/destinations.geojson").then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([net, dest]) => {
        if (cancelled) return;
        setNetwork(net as WalkNetwork);
        setDestinations(
          ((dest.features ?? []) as Array<{
            geometry: { coordinates: [number, number] };
            properties: Omit<Destination, "lng" | "lat">;
          }>).map((f) => ({
            ...f.properties,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, network]);

  return { network, destinations, loading, failed };
}

/** Per-edge sun exposure for one date, fetched when the date changes. */
export function useExposure(dateKey: string, enabled: boolean) {
  const [exposure, setExposure] = useState<Record<string, number[]> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/data/exposure/${dateKey}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { slots: Record<string, number[]> }) => {
        if (!cancelled) setExposure(data.slots);
      })
      .catch(() => {
        if (!cancelled) setExposure(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dateKey, enabled]);

  return exposure;
}
