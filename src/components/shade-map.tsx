"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type DataDrivenPropertyValueSpecification,
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
import {
  CATEGORY_COLOURS,
  DESTINATION_CATEGORIES,
  type DestinationCategory,
} from "@/lib/destinations";
import { nearestNode } from "@/lib/network";
import { planRoutes, type Route } from "@/lib/routing";
import { useExposure, useRouteData } from "@/lib/use-route-data";
import { ReadingCard } from "./reading-card";
import { RoutePlanner, type PlannerPreference, type RoutePoint } from "./route-planner";

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

type LayerKey = "shade" | "trees" | "readings" | "corners" | "destinations";

/** Preference -> the shade weights fed to the planner. Every preference
 *  still returns several routes; it decides which one is highlighted and
 *  what the search optimises for first. */
const PREFERENCE_WEIGHTS: Record<PlannerPreference, number[]> = {
  shade: [1, 0.6, 0.2],
  balanced: [0.6, 1, 0.2],
  shortest: [0, 0.4, 0.9],
};

/** MapLibre types a `match` expression as a fixed-arity tuple, which a
 *  spread cannot satisfy; assemble it and assert the shape once here. */
function destinationColourExpression(): DataDrivenPropertyValueSpecification<string> {
  return [
    "match",
    ["get", "category"],
    ...DESTINATION_CATEGORIES.flatMap((c) => [c, CATEGORY_COLOURS[c]]),
    "#525252",
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

/** Restaurants are ~250 points and would bury the shade layer, so they
 *  start hidden while every other category starts on. */
const DEFAULT_CATEGORIES: Record<DestinationCategory, boolean> = {
  pharmacy: true,
  library: true,
  hospital: true,
  health_center: true,
  public_housing: true,
  restaurant: false,
  park: true,
};

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
  const tDest = useTranslations("destinations");
  const tRoute = useTranslations("route");
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
  const [planning, setPlanning] = useState(false);
  const [start, setStart] = useState<RoutePoint | null>(null);
  const [end, setEnd] = useState<RoutePoint | null>(null);
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const [preference, setPreference] = useState<PlannerPreference>("shade");
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [categories, setCategories] =
    useState<Record<DestinationCategory, boolean>>(DEFAULT_CATEGORIES);

  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    shade: true,
    destinations: true,
    // Trees on by default: they are the shade you can plant, so the map
    // should open showing where the canopy already is and where it isn't.
    trees: true,
    readings: true,
    corners: true,
  });
  const [selectedReading, setSelectedReading] = useState<PublicReading | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<{
    name: string;
    address: string | null;
    category: string;
  } | null>(null);

  const activeDate = useMemo(
    () => index.dates.find((d) => d.dateKey === dateKey) ?? index.dates[0],
    [index.dates, dateKey],
  );
  const slot = useMemo(
    () => nearestSlot(minutes, activeDate.slots),
    [minutes, activeDate],
  );

  // Network and destinations load only once the planner is opened; most
  // visits never route.
  const { network, destinations, loading: routeDataLoading } = useRouteData(planning);
  const exposureByDate = useExposure(activeDate.dateKey, planning);
  const exposure = exposureByDate?.[slot.time] ?? null;

  const routes: Route[] = useMemo(() => {
    if (!planning || !network || !exposure || !start || !end) return [];
    const a = nearestNode(network, [start.lng, start.lat]);
    const b = nearestNode(network, [end.lng, end.lat]);
    return planRoutes(network, exposure, a, b, PREFERENCE_WEIGHTS[preference]);
  }, [planning, network, exposure, start, end, preference]);

  // Clamp rather than sync: when the route list changes underneath a stale
  // selection, fall back to the first route without an effect round-trip.
  const activeRoute = selectedRoute < routes.length ? selectedRoute : 0;

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
      map.addSource("destinations", {
        type: "geojson",
        data: "/data/destinations.geojson",
      });
      map.addSource("routes", { type: "geojson", data: EMPTY });
      map.addSource("route-ends", { type: "geojson", data: EMPTY });

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
        paint: {
          "circle-radius": 3,
          "circle-color": "#15803d",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });
      // Alternatives first, in a muted tone, so the chosen route reads as
      // the answer and the others as options rather than clutter.
      map.addLayer({
        id: "routes-alt",
        type: "line",
        source: "routes",
        filter: ["!=", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#64748b", "line-width": 4, "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "routes-selected-casing",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 10 },
      });
      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1d4ed8", "line-width": 6 },
      });

      map.addLayer({
        id: "destinations-dots",
        type: "circle",
        source: "destinations",
        paint: {
          "circle-radius": 6,
          "circle-color": destinationColourExpression(),
          "circle-stroke-width": 2,
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

      map.addLayer({
        id: "route-ends-dots",
        type: "circle",
        source: "route-ends",
        paint: {
          "circle-radius": 10,
          "circle-color": ["case", ["==", ["get", "role"], "start"], "#16a34a", "#dc2626"],
          "circle-stroke-width": 3,
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

  /**
   * Click-to-set for the planner. This lives in its own effect rather than
   * in the map-init closure because it must see the *current* `picking`
   * value; a handler registered once at init would capture the value from
   * first render and silently stop responding.
   */
  useEffect(() => {
    if (!map || !picking) return;

    const onClick = (event: { lngLat: { lng: number; lat: number } }) => {
      const point: RoutePoint = {
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
        label: `${event.lngLat.lat.toFixed(4)}, ${event.lngLat.lng.toFixed(4)}`,
      };
      if (picking === "start") setStart(point);
      else setEnd(point);
      // Setting a start naturally leads to setting a destination.
      setPicking(picking === "start" && !end ? "end" : null);
    };

    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [map, picking, end]);

  // Tapping a destination while picking uses that place as the point.
  useEffect(() => {
    if (!map) return;
    const onClick = (event: {
      features?: Array<{ properties?: Record<string, unknown> } | undefined>;
      lngLat: { lng: number; lat: number };
    }) => {
      const props = event.features?.[0]?.properties;
      if (!props) return;
      const point: RoutePoint = {
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
        label: String(props.name ?? ""),
      };
      if (picking === "start") {
        setStart(point);
        setPicking(end ? null : "end");
      } else if (picking === "end") {
        setEnd(point);
        setPicking(null);
      } else {
        setSelectedDestination({
          name: String(props.name ?? ""),
          address: props.address ? String(props.address) : null,
          category: String(props.category ?? ""),
        });
      }
    };
    map.on("click", "destinations-dots", onClick);
    return () => {
      map.off("click", "destinations-dots", onClick);
    };
  }, [map, picking, end]);

  // Category filter on the destinations layer.
  useEffect(() => {
    if (!map || !map.getLayer("destinations-dots")) return;
    const enabled = DESTINATION_CATEGORIES.filter((c) => categories[c]);
    map.setFilter("destinations-dots", [
      "in",
      ["get", "category"],
      ["literal", enabled],
    ]);
  }, [map, categories]);

  // Route geometry and endpoint markers.
  useEffect(() => {
    const source = map?.getSource("routes") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      // Draw the selected route last so it sits above its alternatives.
      features: routes
        .map((route, i) => ({
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: route.line },
          properties: { index: i, selected: i === activeRoute },
        }))
        .sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected)),
    });
  }, [map, routes, activeRoute]);

  useEffect(() => {
    const source = map?.getSource("route-ends") as GeoJSONSource | undefined;
    const points = [
      start ? { role: "start", point: start } : null,
      end ? { role: "end", point: end } : null,
    ].filter((x): x is { role: string; point: RoutePoint } => x !== null);
    source?.setData({
      type: "FeatureCollection",
      features: points.map(({ role, point }) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
        properties: { role },
      })),
    });
  }, [map, start, end]);

  // Layer toggles.
  useEffect(() => {
    if (!map) return;
    const mapping: Record<LayerKey, string[]> = {
      shade: ["shade-building", "shade-tree"],
      trees: ["trees-dots"],
      readings: ["readings-dots"],
      corners: ["corners-dots"],
      destinations: ["destinations-dots"],
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
            ["destinations", tDest("title")],
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

      {visible.destinations ? (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 font-semibold">{tDest("title")}</legend>
          {DESTINATION_CATEGORIES.map((category) => (
            <label
              key={category}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 px-3 text-sm"
            >
              <input
                type="checkbox"
                checked={categories[category]}
                onChange={(e) =>
                  setCategories((c) => ({ ...c, [category]: e.target.checked }))
                }
                className="h-4 w-4"
              />
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: CATEGORY_COLOURS[category] }}
              />
              {tDest(`category.${category}` as never)}
            </label>
          ))}
          <p className="w-full text-xs text-neutral-600">{tDest("note")}</p>
          {categories.public_housing ? (
            // Honest about a real gap in the source data rather than letting
            // a near-empty layer imply there is no public housing here.
            <p className="w-full text-xs text-neutral-600">{tDest("bhaNote")}</p>
          ) : null}
        </fieldset>
      ) : null}

      <Legend />

      <div>
        <button
          type="button"
          onClick={() => {
            setPlanning((p) => !p);
            setPicking(null);
          }}
          aria-expanded={planning}
          className="min-h-[56px] w-full rounded-xl bg-neutral-900 px-6 text-lg font-semibold text-white sm:w-auto"
        >
          {tRoute("title")}
        </button>
      </div>

      {planning ? (
        <RoutePlanner
          start={start}
          end={end}
          picking={picking}
          onPick={setPicking}
          onSetPoint={(which, point) => {
            if (which === "start") setStart(point);
            else setEnd(point);
          }}
          onSwap={() => {
            setStart(end);
            setEnd(start);
          }}
          onClear={() => {
            setStart(null);
            setEnd(null);
            setPicking(null);
          }}
          destinations={destinations}
          routes={routes}
          selectedRoute={activeRoute}
          onSelectRoute={setSelectedRoute}
          preference={preference}
          onPreferenceChange={setPreference}
          loading={routeDataLoading || (!!start && !!end && !exposure)}
          timeLabel={timeLabel}
        />
      ) : null}

      {selectedDestination ? (
        <aside className="rounded-xl border border-neutral-300 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selectedDestination.name}</h2>
              <p className="text-sm text-neutral-600">
                {tDest(`category.${selectedDestination.category}` as never)}
                {selectedDestination.address ? ` · ${selectedDestination.address}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDestination(null)}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-neutral-300 px-3"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </aside>
      ) : null}

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
