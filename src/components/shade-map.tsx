"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useLocale, useTranslations } from "next-intl";
import type { FeatureCollection } from "geojson";
import { CHINATOWN_BBOX_ARRAY, CHINATOWN_CENTRE } from "@/lib/chinatown";
import {
  formatSlotLabel,
  nearestShadeDate,
  nearestSlot,
  slotFileName,
  type ShadeIndex,
} from "@/lib/shade-index";
import type { PublicReading } from "@/lib/public-readings";
import type { PublicCorner } from "@/lib/public-corners";
import { ReadingCard } from "./reading-card";

const FALLBACK_STYLE = "https://tiles.openfreemap.org/styles/positron";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * MapLibre parses GeoJSON in a web worker. Bundled through Next, its
 * internal `new Worker(new URL(...))` resolves to the page URL instead of
 * the worker script, so the worker loads HTML, dies silently, and every
 * GeoJSON source stays empty forever — no error, just a blank map. Serving
 * the worker as a static asset (copied to public/ by scripts/copy-maplibre-worker.ts,
 * which runs before build) and pointing MapLibre at it avoids the bundler
 * entirely.
 */
setWorkerUrl("/maplibre-gl-worker.mjs");

type LayerKey = "shade" | "trees" | "readings" | "corners";

export function ShadeMap({
  index,
  readings,
  corners,
}: {
  index: ShadeIndex;
  readings: PublicReading[];
  corners: PublicCorner[];
}) {
  const t = useTranslations("map");
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // The loaded map instance, not a boolean. React StrictMode mounts effects
  // twice in development: the first map is created, fires `load`, and is then
  // torn down. A boolean "ready" flag would still be true for the second map,
  // so the effects that push data in would never re-run and the surviving map
  // would render empty. Keying on instance identity makes them re-run.
  const [map, setMap] = useState<MapLibreMap | null>(null);

  const [minutes, setMinutes] = useState(15 * 60); // 3pm — the hottest hour
  const [dateKey, setDateKey] = useState(
    () => nearestShadeDate(new Date(), index).dateKey,
  );
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    shade: true,
    trees: false,
    readings: true,
    corners: true,
  });
  const [selectedReading, setSelectedReading] = useState<PublicReading | null>(null);

  const activeDate = useMemo(
    () => index.dates.find((d) => d.dateKey === dateKey) ?? index.dates[0],
    [index.dates, dateKey],
  );
  const slot = useMemo(
    () => nearestSlot(minutes, activeDate.slots),
    [minutes, activeDate],
  );

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const instance = new MapLibreMap({
      container: containerRef.current,
      style: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL || FALLBACK_STYLE,
      center: [CHINATOWN_CENTRE.lng, CHINATOWN_CENTRE.lat],
      zoom: 15.2,
      maxBounds: [
        [CHINATOWN_BBOX_ARRAY[0] - 0.01, CHINATOWN_BBOX_ARRAY[1] - 0.01],
        [CHINATOWN_BBOX_ARRAY[2] + 0.01, CHINATOWN_BBOX_ARRAY[3] + 0.01],
      ],
      attributionControl: false,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new AttributionControl({ compact: true }), "bottom-right");

    instance.on("load", () => {
      const map = instance;
      map.addSource("shade", { type: "geojson", data: EMPTY });
      map.addSource("trees", { type: "geojson", data: "/data/trees.geojson" });
      map.addSource("readings", { type: "geojson", data: EMPTY });
      map.addSource("corners", { type: "geojson", data: EMPTY });

      map.addLayer({
        id: "shade-building",
        type: "fill",
        source: "shade",
        filter: ["==", ["get", "kind"], "building"],
        paint: { "fill-color": "#1f2937", "fill-opacity": 0.45 },
      });
      // §14: tree shadows render lighter than building shadows because
      // opaque-circle crowns are the less certain of the two.
      map.addLayer({
        id: "shade-tree",
        type: "fill",
        source: "shade",
        filter: ["==", ["get", "kind"], "tree"],
        paint: { "fill-color": "#166534", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "trees-dots",
        type: "circle",
        source: "trees",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 3,
          "circle-color": "#15803d",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "corners-dots",
        type: "circle",
        source: "corners",
        paint: {
          "circle-radius": 9,
          "circle-color": "#0369a1",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
      // Field readings must be visibly distinguishable from modelled shade
      // (§13): solid, saturated, outlined dots over flat translucent fills.
      map.addLayer({
        id: "readings-dots",
        type: "circle",
        source: "readings",
        paint: {
          "circle-radius": 8,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "deltaF"],
            0,
            "#fde047",
            20,
            "#fb923c",
            40,
            "#dc2626",
          ],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "readings-dots", (event) => {
        const raw = event.features?.[0]?.properties?.payload;
        if (typeof raw === "string") setSelectedReading(JSON.parse(raw) as PublicReading);
      });
      for (const layer of ["readings-dots", "corners-dots"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      setMap(map);
    });

    mapRef.current = instance;
    return () => {
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  // Swap in the precomputed slot whenever the time or date changes. Fetching
  // a ~20KB static file beats recomputing unions in the browser (§6).
  useEffect(() => {
    if (!map) return;

    const source = map.getSource("shade") as GeoJSONSource | undefined;
    if (!source) return;

    if (slot.belowHorizon) {
      source.setData(EMPTY);
      return;
    }

    let cancelled = false;
    fetch(`/data/shade/${activeDate.dateKey}/${slotFileName(slot)}`)
      .then((res) => (res.ok ? res.json() : EMPTY))
      .then((data: FeatureCollection) => {
        if (!cancelled) source.setData(data);
      })
      .catch(() => {
        if (!cancelled) source.setData(EMPTY);
      });

    return () => {
      cancelled = true;
    };
  }, [map, activeDate.dateKey, slot]);

  // Readings and corners are small; push them in as inline GeoJSON.
  useEffect(() => {
    const source = map?.getSource("readings") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: readings.map((reading) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [reading.lng, reading.lat] },
        properties: { deltaF: reading.deltaF ?? 0, payload: JSON.stringify(reading) },
      })),
    });
  }, [map, readings]);

  useEffect(() => {
    const source = map?.getSource("corners") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: corners.map((corner) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [corner.lng, corner.lat] },
        properties: { name: corner.name },
      })),
    });
  }, [map, corners]);

  // Layer toggles.
  useEffect(() => {
    if (!map) return;
    const mapping: Record<LayerKey, string[]> = {
      shade: ["shade-building", "shade-tree"],
      trees: ["trees-dots"],
      readings: ["readings-dots"],
      corners: ["corners-dots"],
    };
    for (const [key, layerIds] of Object.entries(mapping) as [LayerKey, string[]][]) {
      for (const id of layerIds) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible[key] ? "visible" : "none");
        }
      }
    }
  }, [map, visible]);

  const timeLabel = formatSlotLabel(slot.time, locale);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[60vh] min-h-[380px] w-full rounded-xl border border-neutral-200"
          role="application"
          aria-label={t("heading")}
        />
        {slot.belowHorizon ? (
          <p className="absolute inset-x-3 top-3 rounded-lg bg-neutral-900/90 px-3 py-2 text-sm text-white">
            {t("sunBelowHorizon")}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">
            {t("timeOfDay")}: <span className="tabular-nums">{timeLabel}</span>
          </span>
          <input
            type="range"
            min={index.startHour * 60}
            max={index.endHour * 60}
            step={index.stepMinutes}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="h-11 w-full"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("date")}</span>
          <select
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            className="h-11 rounded-lg border border-neutral-300 px-3"
          >
            {index.dates.map((d) => (
              <option key={d.dateKey} value={d.dateKey}>
                {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                  new Date(`${d.date}T12:00:00Z`),
                )}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 font-semibold">{t("layers")}</legend>
        {(
          [
            ["shade", t("layerShade")],
            ["trees", t("layerTrees")],
            ["readings", t("layerReadings")],
            ["corners", t("layerCorners")],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 px-3"
          >
            <input
              type="checkbox"
              checked={visible[key]}
              onChange={(e) => setVisible((v) => ({ ...v, [key]: e.target.checked }))}
              className="h-5 w-5"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <Legend />

      {selectedReading ? (
        <ReadingCard reading={selectedReading} onClose={() => setSelectedReading(null)} />
      ) : null}
    </div>
  );
}

function Legend() {
  const t = useTranslations("map");
  const items = [
    { color: "#1f2937", opacity: 0.45, label: t("legendBuilding") },
    { color: "#166534", opacity: 0.25, label: t("legendTree") },
    { color: "#fb923c", opacity: 1, label: t("legendReading") },
    { color: "#0369a1", opacity: 1, label: t("legendCorner") },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border border-neutral-400"
            style={{ backgroundColor: item.color, opacity: item.opacity }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
