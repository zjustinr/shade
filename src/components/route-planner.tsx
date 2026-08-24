"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Destination } from "@/lib/destinations";
import type { Route } from "@/lib/routing";
import { routeColour } from "@/lib/route-style";

export type RoutePoint = {
  lng: number;
  lat: number;
  label: string;
};

export type PlannerPreference = "shade" | "balanced" | "shortest";

export function RoutePlanner({
  start,
  end,
  picking,
  onPick,
  onSetPoint,
  onSwap,
  onClear,
  destinations,
  routes,
  selectedRoute,
  onSelectRoute,
  preference,
  onPreferenceChange,
  loading,
  timeLabel,
}: {
  start: RoutePoint | null;
  end: RoutePoint | null;
  picking: "start" | "end" | null;
  onPick: (which: "start" | "end" | null) => void;
  onSetPoint: (which: "start" | "end", point: RoutePoint) => void;
  onSwap: () => void;
  onClear: () => void;
  destinations: Destination[];
  routes: Route[];
  selectedRoute: number;
  onSelectRoute: (index: number) => void;
  preference: PlannerPreference;
  onPreferenceChange: (p: PlannerPreference) => void;
  loading: boolean;
  timeLabel: string;
}) {
  const t = useTranslations("route");
  const [query, setQuery] = useState("");
  const [searchFor, setSearchFor] = useState<"start" | "end">("end");

  /**
   * Search is over the destinations already downloaded, on this device.
   * No geocoding service is called: §10 forbids sending user data
   * off-origin, and where somebody is walking from and to is exactly that.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return destinations
      .filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.address ?? "").toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, destinations]);

  return (
    <section className="rounded-xl border border-neutral-300 p-4">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-neutral-700">{t("intro")}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <PointButton
          label={t("start")}
          point={start}
          active={picking === "start"}
          activeHint={t("tapStart")}
          setHint={t("setStart")}
          onClick={() => onPick(picking === "start" ? null : "start")}
          tone="start"
        />
        <PointButton
          label={t("end")}
          point={end}
          active={picking === "end"}
          activeHint={t("tapEnd")}
          setHint={t("setEnd")}
          onClick={() => onPick(picking === "end" ? null : "end")}
          tone="end"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSwap}
          disabled={!start || !end}
          className="min-h-[44px] rounded-lg border border-neutral-300 px-4 text-sm font-medium disabled:opacity-40"
        >
          {t("swap")}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!start && !end}
          className="min-h-[44px] rounded-lg border border-neutral-300 px-4 text-sm font-medium disabled:opacity-40"
        >
          {t("clear")}
        </button>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-semibold" htmlFor="place-search">
          {t("search")}
        </label>
        <div className="mt-1 flex gap-2">
          <select
            aria-label={t("search")}
            value={searchFor}
            onChange={(e) => setSearchFor(e.target.value as "start" | "end")}
            className="h-11 rounded-lg border border-neutral-300 px-2 text-sm"
          >
            <option value="start">{t("start")}</option>
            <option value="end">{t("end")}</option>
          </select>
          <input
            id="place-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-lg border border-neutral-300 px-3"
            autoComplete="off"
          />
        </div>
        {matches.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1">
            {matches.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSetPoint(searchFor, { lng: d.lng, lat: d.lat, label: d.name });
                    setQuery("");
                  }}
                  className="flex min-h-[44px] w-full flex-col items-start rounded-lg border border-neutral-200 px-3 py-1 text-left hover:bg-neutral-50"
                >
                  <span className="font-medium">{d.name}</span>
                  {d.address ? (
                    <span className="text-xs text-neutral-600">{d.address}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">{t("preference")}</legend>
        <p className="text-xs text-neutral-600">
          {t("when")}: {timeLabel}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["shade", t("prefShade")],
              ["balanced", t("prefBalanced")],
              ["shortest", t("prefShortest")],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="relative flex flex-1 cursor-pointer"
            >
              <input
                type="radio"
                name="shade-preference"
                value={value}
                checked={preference === value}
                onChange={() => onPreferenceChange(value)}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
              />
              <span
                className={`flex min-h-[44px] w-full items-center justify-center rounded-lg border-2 px-3 text-center text-sm font-medium peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 ${
                  preference === value
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300"
                }`}
              >
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">{t("results")}</h3>
        {!start || !end ? (
          <p className="mt-1 text-sm text-neutral-600">{t("needBoth")}</p>
        ) : loading ? (
          <p className="mt-1 text-sm text-neutral-600">{t("calculating")}</p>
        ) : routes.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">{t("noRoute")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {routes.map((route, i) => {
              const shadiest = i === 0;
              const quickest =
                route.distanceM === Math.min(...routes.map((r) => r.distanceM));
              const colour = routeColour(i);
              const selected = selectedRoute === i;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelectRoute(i)}
                    aria-pressed={selected}
                    className={`w-full rounded-lg border-2 px-3 py-2 text-left ${
                      selected ? "" : "border-neutral-200"
                    }`}
                    // The card borrows the route's own colour when selected,
                    // so card, badge and map line read as one thing.
                    style={
                      selected
                        ? { borderColor: colour, backgroundColor: `${colour}14` }
                        : undefined
                    }
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* Same badge as the one sitting on the map line:
                          number-in-a-circle in the route's colour. */}
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white shadow"
                        style={{ backgroundColor: colour }}
                      >
                        {i + 1}
                      </span>
                      <span className="font-semibold">
                        {t("routeLabel", { n: i + 1 })}
                      </span>
                      {selected ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                          style={{ backgroundColor: colour }}
                        >
                          {t("selected")}
                        </span>
                      ) : null}
                      {shadiest ? <Tag>{t("shadiest")}</Tag> : null}
                      {quickest ? <Tag>{t("quickest")}</Tag> : null}
                    </div>
                    {/* A definition list rather than bare spans: each figure
                        gets its own labelled element, so a screen reader
                        announces "62 percent in shade, 410 m, 6 min walk"
                        instead of running the three numbers together. */}
                    <dl className="mt-1 flex flex-wrap gap-x-4 text-sm">
                      <div data-stat="shade">
                        <dt className="sr-only">{t("inShade")}</dt>
                        <dd className="font-bold tabular-nums">
                          {Math.round(route.shadePercent)}%{" "}
                          <span className="font-normal">{t("inShade")}</span>
                        </dd>
                      </div>
                      <div data-stat="distance">
                        <dt className="sr-only">{t("metres")}</dt>
                        <dd className="tabular-nums text-neutral-700">
                          {Math.round(route.distanceM)}
                          {t("metres")}
                        </dd>
                      </div>
                      <div data-stat="duration">
                        <dt className="sr-only">{t("minutes")}</dt>
                        <dd className="tabular-nums text-neutral-700">
                          {Math.max(1, Math.round(route.seconds / 60))} {t("minutes")}
                        </dd>
                      </div>
                    </dl>
                    {/* A bar makes the shade share comparable at a glance,
                        which is the whole decision this screen supports. */}
                    <div
                      className="mt-1 h-2 w-full overflow-hidden rounded-full bg-amber-200"
                      aria-hidden
                    >
                      <div
                        className="h-full bg-neutral-700"
                        style={{ width: `${route.shadePercent}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-3 text-xs leading-snug text-neutral-600">{t("disclaimer")}</p>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

function PointButton({
  label,
  point,
  active,
  activeHint,
  setHint,
  onClick,
  tone,
}: {
  label: string;
  point: RoutePoint | null;
  active: boolean;
  activeHint: string;
  setHint: string;
  onClick: () => void;
  tone: "start" | "end";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-[56px] flex-col items-start rounded-lg border-2 px-3 py-2 text-left ${
        active
          ? "border-blue-700 bg-blue-50"
          : point
            ? "border-neutral-400"
            : "border-dashed border-neutral-400"
      }`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        <span
          aria-hidden
          className={`inline-block h-3 w-3 rounded-full ${
            tone === "start" ? "bg-green-600" : "bg-red-600"
          }`}
        />
        {label}
      </span>
      <span className="text-sm">
        {active ? activeHint : (point?.label ?? setHint)}
      </span>
    </button>
  );
}
