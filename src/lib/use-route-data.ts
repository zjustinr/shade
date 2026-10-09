"use client";

import { useEffect, useState } from "react";
import type { WalkNetwork } from "@/lib/network";
import type { Destination } from "@/lib/destinations";
import type { WindClimate } from "@/lib/wind";

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

/** What the wind model ships: pedestrian-level speed relative to open ground. */
export type WindRatios = {
  generatedAt: string;
  model: string;
  sectorCount: number;
  edgeCount: number;
  /** ratios[sector][edge] is the pedestrian-level speed as a percentage of
   *  the open-terrain reference speed, for wind from that sector. */
  ratios: number[][];
};

/**
 * Wind data for the planner: the observed climatology (which way it usually
 * blows, by season and hour) and the per-street model. Fetched only when
 * the planner is open. Both are static files — and a failure just means no
 * wind figures, never a made-up one.
 */
export function useWindData(enabled: boolean) {
  const [climate, setClimate] = useState<WindClimate | null>(null);
  const [model, setModel] = useState<WindRatios | null>(null);

  useEffect(() => {
    if (!enabled || (climate && model)) return;
    let cancelled = false;
    Promise.all([
      fetch("/data/wind/climate.json").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/data/wind/ratios.json").then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([c, m]) => {
        if (cancelled) return;
        setClimate(c as WindClimate);
        setModel(m as WindRatios);
      })
      .catch(() => {
        // No wind data: the planner keeps working, minus the wind controls.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, climate, model]);

  return { climate, model };
}
