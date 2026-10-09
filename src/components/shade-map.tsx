"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type DataDrivenPropertyValueSpecification,
  type MapLayerMouseEvent,
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
import { edgeLine, nearestNode } from "@/lib/network";
import { planRoutes, windyEndMph, type Route, type WindPreference } from "@/lib/routing";
import { useExposure, useRouteData, useWindData } from "@/lib/use-route-data";
import { typicalWind } from "@/lib/wind";
import type { WindControlsState, WindDirChoice, WindPref, WindStrength } from "@/components/route-planner";
import { badgeFraction, pointAlong, routeColour } from "@/lib/route-style";
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

function nowSliderMinutes(index: ShadeIndex): number {
  const now = new Date();
  const snapped =
    Math.round((now.getHours() * 60 + now.getMinutes()) / index.stepMinutes) *
    index.stepMinutes;
  if (snapped < index.startHour * 60 || snapped > index.endHour * 60) return 15 * 60;
  return snapped;
}

type LayerKey = "shade" | "trees" | "readings" | "corners" | "destinations" | "wind";

/** Open-terrain 10 m wind speeds (mph) offered as "light" and "strong". */
const WIND_STRENGTH_MPH: Record<Exclude<WindStrength, "typical">, number> = {
  light: 6,
  strong: 25,
};

/** Preference -> the shade weights fed to the planner. Every preference
 *  still returns several routes; it decides which one is highlighted and
 *  what the search optimises for first. */
const PREFERENCE_WEIGHTS: Record<PlannerPreference, number[]> = {
  shade: [1, 0.6, 0.2],
  // Winter mode: identical weights, but the planner seeks sun instead of
  // shade — the warmest walk on a cold day is the sunniest one.
  sun: [1, 0.6, 0.2],
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
  readings: initialReadings,
  corners: initialCorners,
}: {
  index: ShadeIndex;
  readings: PublicReading[];
  corners: PublicCorner[];
}) {
  const t = useTranslations("map");
  const tDest = useTranslations("destinations");
  const tRoute = useTranslations("route");
  const locale = useLocale();

  /**
   * Server-rendered data is the starting point, then one runtime fetch
   * brings it current. On the website this closes the gap left by the
   * 5-minute page cache; in the iOS app it is the only source of fresh
   * readings at all — the bundle is static files frozen at build time
   * (NEXT_PUBLIC_API_BASE points those requests at the live site). A
   * failed fetch keeps whatever we have: offline, baked data beats none.
   */
  const [readings, setReadings] = useState(initialReadings);
  const [corners, setCorners] = useState(initialCorners);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE ?? "";
    let cancelled = false;
    const refresh = async <T,>(path: string, apply: (rows: T[]) => void) => {
      try {
        const res = await fetch(`${base}${path}`);
        if (!res.ok) return;
        const rows = (await res.json()) as T[];
        if (!cancelled && Array.isArray(rows)) apply(rows);
      } catch {
        // Offline or the API is unreachable — the baked data stands.
      }
    };
    void refresh<PublicReading>("/api/public/readings", setReadings);
    void refresh<PublicCorner>(`/api/public/corners?locale=${locale}`, setCorners);
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // The loaded map instance, not a boolean. React StrictMode mounts effects
  // twice in development: the first map is created, fires `load`, and is then
  // torn down. A boolean "ready" flag would still be true for the second map,
  // so the effects that push data in would never re-run and the surviving map
  // would render empty. Keying on instance identity makes them re-run.
  const [map, setMap] = useState<MapLibreMap | null>(null);

  // Departure time defaults to "now": people plan the walk they are about
  // to take (the lesson from Korea's Geuneullo, where time-of-departure is
  // the core control). Outside the slider's day, fall back to 3pm — the
  // hottest hour and the most instructive one to browse.
  const [minutes, setMinutes] = useState(() => nowSliderMinutes(index));
  const [dateKey, setDateKey] = useState(
    () => nearestShadeDate(new Date(), index).dateKey,
  );
  const [planning, setPlanning] = useState(false);
  const [start, setStart] = useState<RoutePoint | null>(null);
  const [end, setEnd] = useState<RoutePoint | null>(null);
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  // Season decides the default ask: shade in the hot months, sun in the
  // cold ones (the same model answers both). Only the default — an explicit
  // choice of balanced/shortest is never overridden.
  const [preference, setPreference] = useState<PlannerPreference>(() =>
    nearestShadeDate(new Date(), index).dateKey === "winter-solstice" ? "sun" : "shade",
  );
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
    // Wind is opt-in: the map opens on shade, the question it exists for.
    wind: false,
  });
  const [windPref, setWindPref] = useState<WindPref>("any");
  const [windDir, setWindDir] = useState<WindDirChoice>("typical");
  const [windStrength, setWindStrength] = useState<WindStrength>("typical");
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
  const wantsNetwork = planning || visible.wind;
  const { network, destinations, loading: routeDataLoading } = useRouteData(wantsNetwork);
  const exposureByDate = useExposure(activeDate.dateKey, planning);
  const exposure = exposureByDate?.[slot.time] ?? null;
  const { climate, model: windModel } = useWindData(wantsNetwork);

  // Which wind, and how strong. "Typical" is what Logan Airport actually
  // recorded at this season and hour over 16 years; the person can override
  // either part. The result is a speed per sidewalk edge: the model's ratio
  // (how much the street changes the wind) times the open-ground speed.
  const wind = useMemo(() => {
    if (!network || !climate || !windModel) return null;
    if (windModel.edgeCount !== network.edges.length) return null; // stale data: say nothing
    const hour = Number(slot.time.slice(0, 2));
    const usual = typicalWind(climate, activeDate.dateKey, hour);
    if (!usual) return null;
    const sector = windDir === "typical" ? usual.sector : windDir;
    const row = climate.dates[activeDate.dateKey]?.hours[hour];
    const refMph =
      windStrength === "typical"
        ? windDir === "typical"
          ? usual.speedMph
          : row?.speedMph[sector] || row?.medianMph || usual.speedMph
        : WIND_STRENGTH_MPH[windStrength];
    const ratios = windModel.ratios[sector];
    return {
      usual,
      sector,
      refMph,
      mph: ratios.map((r) => (r / 100) * refMph),
    };
  }, [network, climate, windModel, slot.time, activeDate.dateKey, windDir, windStrength]);

  const routes: Route[] = useMemo(() => {
    if (!planning || !network || !exposure || !start || !end) return [];
    const a = nearestNode(network, [start.lng, start.lat]);
    const b = nearestNode(network, [end.lng, end.lat]);
    // Wind figures are always reported when there is a model; they only
    // STEER the route when the person asked for calmer or breezier.
    // Weight 2: choosing "calmer" is an explicit request, so wind outweighs
    // the shade term. Measured on 400 random trips between real
    // destinations at a usual summer afternoon wind, this avoids the windy
    // stretch in about half the trips that have one, at a cost of about 7
    // points of shade and 14 m — a modest, honest trade, not a miracle.
    const windPreference: WindPreference | null = wind
      ? {
          mph: wind.mph,
          seek: windPref === "breeze" ? "breeze" : "calm",
          weight: windPref === "any" ? 0 : 2,
          // Relative to today's own windy end, so a strong-wind day still
          // tells a 13 mph street from a 27 mph one.
          fullMph: windyEndMph(wind.mph),
        }
      : null;
    return planRoutes(
      network,
      exposure,
      a,
      b,
      PREFERENCE_WEIGHTS[preference],
      3,
      preference === "sun" ? "sun" : "shade",
      windPreference,
    );
  }, [planning, network, exposure, start, end, preference, wind, windPref]);

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
      // Wind on the sidewalks, drawn under the routes so a chosen route is
      // never hidden by the colour of the street it runs along.
      map.addSource("wind-edges", { type: "geojson", data: EMPTY });
      // A white casing under the lines so the colour reads against a
      // consistent background: without it, calm streets inside the grey
      // building shadows looked darker and heavier than the open, windy
      // ones — the reverse of the truth. Violet, because every route colour
      // (blue, magenta, teal, brown, olive) is taken, and width grows with
      // the wind so the meaning survives colour-blindness too.
      const WIND_WIDTH = [
        "interpolate", ["linear"], ["get", "mph"], 0, 2.2, 6, 3.6, 12, 5.5,
      ] as const;
      map.addLayer({
        id: "wind-edges-casing",
        type: "line",
        source: "wind-edges",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.85,
          "line-width": [
            "interpolate", ["linear"], ["get", "mph"], 0, 4.2, 6, 5.6, 12, 7.5,
          ],
        },
      });
      map.addLayer({
        id: "wind-edges",
        type: "line",
        source: "wind-edges",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": WIND_WIDTH as unknown as number,
          "line-opacity": 1,
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "mph"],
            0, "#ddd6fe",
            3, "#c4b5fd",
            6, "#8b5cf6",
            10, "#5b21b6",
            15, "#2e1065",
          ],
        },
      });
      map.addSource("routes", { type: "geojson", data: EMPTY });
      map.addSource("route-sun", { type: "geojson", data: EMPTY });
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
      // Each route keeps its own colour whether or not it is selected —
      // the colour is its identity, matching its card and its numbered
      // badge. Selection is shown by weight instead: alternatives are
      // thin and dashed, the chosen route is wide, solid, and sits on a
      // white casing. Weight + dash also survives colour-blindness.
      map.addLayer({
        id: "routes-alt",
        type: "line",
        source: "routes",
        filter: ["!=", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 4,
          "line-opacity": 0.75,
          "line-dasharray": [2, 1.5],
        },
      });
      map.addLayer({
        id: "routes-selected-casing",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 11 },
      });
      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 7 },
      });
      // Amber ticks over the stretches of the chosen route that are in sun
      // at the selected time — "which part of this walk is the sunny part"
      // is the per-segment view Geuneullo showed people actually use.
      map.addLayer({
        id: "route-sun-segments",
        type: "line",
        source: "route-sun",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 3.5,
          "line-dasharray": [1.2, 1.4],
          // Graded, not binary: a half-sunny stretch shows faintly, a fully
          // sunlit one strongly. A hard >50% cut hid almost half the real
          // sun on partially-exposed edges.
          "line-opacity": ["interpolate", ["linear"], ["get", "sun"], 25, 0.35, 100, 1],
        },
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

  /**
   * Clicking a route line — either version of it — selects that route, so
   * the map and the card list stay two views of the same choice. Ignored
   * while the user is placing a start/end point, when a map tap means
   * "here", not "this one".
   */
  useEffect(() => {
    if (!map || picking) return;
    const onClick = (event: MapLayerMouseEvent) => {
      const index = event.features?.[0]?.properties?.index;
      if (typeof index === "number") setSelectedRoute(index);
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    for (const layer of ["routes-alt", "routes-selected"]) {
      if (!map.getLayer(layer)) continue;
      map.on("click", layer, onClick);
      map.on("mouseenter", layer, onEnter);
      map.on("mouseleave", layer, onLeave);
    }
    return () => {
      for (const layer of ["routes-alt", "routes-selected"]) {
        map.off("click", layer, onClick);
        map.off("mouseenter", layer, onEnter);
        map.off("mouseleave", layer, onLeave);
      }
    };
  }, [map, picking]);

  /**
   * Numbered badges pinned to each route line — the direct answer to
   * "which line is Route 2". HTML markers rather than a symbol layer
   * because symbol text needs the basemap style to provide glyphs, and the
   * badge must not vanish if the basemap fails to load. Staggered along
   * each route so shared first/last blocks don't stack the numbers.
   */
  useEffect(() => {
    if (!map) return;
    const markers: Marker[] = [];
    routes.forEach((route, i) => {
      const selected = i === activeRoute;
      const colour = routeColour(i);
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = String(i + 1);
      el.setAttribute("aria-label", tRoute("routeLabel", { n: i + 1 }));
      el.setAttribute("aria-pressed", String(selected));
      const size = selected ? 30 : 24;
      el.style.cssText =
        `width:${size}px;height:${size}px;border-radius:9999px;` +
        `background:${colour};color:#fff;border:2px solid #fff;` +
        `font:700 ${selected ? 15 : 13}px/1 system-ui,sans-serif;` +
        `display:flex;align-items:center;justify-content:center;padding:0;` +
        `cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.45)` +
        (selected ? `,0 0 0 3px ${colour}55;z-index:2;` : `;opacity:.92;`);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedRoute(i);
      });
      markers.push(
        new Marker({ element: el })
          .setLngLat(pointAlong(route.line, badgeFraction(i)))
          .addTo(map),
      );
    });
    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [map, routes, activeRoute, tRoute]);

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
          properties: { index: i, selected: i === activeRoute, color: routeColour(i) },
        }))
        .sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected)),
    });
  }, [map, routes, activeRoute]);

  // Wind on every sidewalk, for the wind layer.
  useEffect(() => {
    const source = map?.getSource("wind-edges") as GeoJSONSource | undefined;
    if (!source) return;
    if (!network || !wind || !visible.wind) {
      source.setData(EMPTY);
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: network.edges.map((edge, i) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: edgeLine(network, i, edge.a),
        },
        properties: { mph: Math.round((wind.mph[i] ?? 0) * 10) / 10 },
      })),
    });
  }, [map, network, wind, visible.wind]);

  // The selected route's sunny stretches, as separate segments for the
  // amber overlay. Exposure is per edge, so this is a lookup, not geometry
  // work.
  useEffect(() => {
    const source = map?.getSource("route-sun") as GeoJSONSource | undefined;
    if (!source) return;
    const route = routes[activeRoute];
    if (!route || !network || !exposure) {
      source.setData(EMPTY);
      return;
    }
    const features = route.edges
      .map((edgeIndex, i) => ({ edgeIndex, fromNode: route.nodes[i] }))
      .filter(({ edgeIndex }) => (exposure[edgeIndex] ?? 0) > 25)
      .map(({ edgeIndex, fromNode }) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: edgeLine(network, edgeIndex, fromNode),
        },
        properties: { sun: exposure[edgeIndex] ?? 0 },
      }));
    source.setData({ type: "FeatureCollection", features });
  }, [map, routes, activeRoute, network, exposure]);

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
      wind: ["wind-edges-casing", "wind-edges"],
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
          <span className="flex items-center gap-2 font-semibold">
            <span>
              {t("timeOfDay")}: <span className="tabular-nums">{timeLabel}</span>
            </span>
            <button
              type="button"
              onClick={() => setMinutes(nowSliderMinutes(index))}
              className="rounded-md border border-neutral-300 px-2 py-0.5 text-sm font-medium"
            >
              {t("now")}
            </button>
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
            onChange={(e) => {
              const next = e.target.value;
              setDateKey(next);
              // Flip the seasonal default with the season, but leave an
              // explicit balanced/shortest choice alone.
              if (next === "winter-solstice" && preference === "shade") {
                setPreference("sun");
              } else if (next !== "winter-solstice" && preference === "sun") {
                setPreference("shade");
              }
            }}
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
            ["wind", t("layerWind")],
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

      <Legend showWind={visible.wind && !!wind} />

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
          wind={
            wind
              ? ({
                  available: true,
                  pref: windPref,
                  onPrefChange: setWindPref,
                  dir: windDir,
                  onDirChange: setWindDir,
                  strength: windStrength,
                  onStrengthChange: setWindStrength,
                  sector: wind.sector,
                  refMph: wind.refMph,
                  usualSector: wind.usual.sector,
                } satisfies WindControlsState)
              : ({ available: false } satisfies WindControlsState)
          }
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

function Legend({ showWind }: { showWind: boolean }) {
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
      {showWind ? (
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3 w-16 rounded-sm border border-neutral-400"
            style={{
              background:
                "linear-gradient(to right, #ddd6fe, #c4b5fd, #8b5cf6, #5b21b6, #2e1065)",
            }}
          />
          {t("legendWind")}
        </li>
      ) : null}
    </ul>
  );
}
