"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCachedSites, queueReading, type CachedSite } from "@/lib/offline-db";
import { useLocalStorage } from "@/lib/use-local-storage";
import { syncPendingReadings } from "@/lib/sync";
import { shadeSourceValues, surfaceTypeValues, windFromValues } from "@/db/schema";
import {
  WIND_SANITY_WARN_MPH,
  WIND_UNITS,
  WIND_UNIT_LABELS,
  roundMph,
  toMph,
  type WindUnit,
} from "@/lib/wind-units";

const OBSERVER_KEY = "shade:observer";
// The anemometer's unit rarely changes between sites, so remember it.
const WIND_UNIT_KEY = "shade:wind-unit";

/** Empty means "not measured"; anything typed that is not a non-negative
 *  number is a mistake the person must see, never something to drop. */
function parseOptionalSpeed(text: string): { value: number | null; invalid: boolean } {
  if (text.trim() === "") return { value: null, invalid: false };
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? { value: n, invalid: false } : { value: null, invalid: true };
}

export default function CapturePage({ params }: { params: Promise<{ siteCode: string }> }) {
  const { siteCode } = use(params);
  const router = useRouter();

  const [site, setSite] = useState<CachedSite | null>(null);
  // Persisted so a crew member types their name once per shift, not once per site.
  const [observer, setObserver] = useLocalStorage(OBSERVER_KEY, "");
  const [recordedAt] = useState(() => new Date());
  const [surfaceType, setSurfaceType] = useState<string>("");
  const [sunTemp, setSunTemp] = useState("");
  const [shadeTemp, setShadeTemp] = useState("");
  const [airTemp, setAirTemp] = useState("");
  const [windSpeed, setWindSpeed] = useState("");
  const [windGust, setWindGust] = useState("");
  const [windFrom, setWindFrom] = useState<string>("");
  const [storedWindUnit, setWindUnit] = useLocalStorage(WIND_UNIT_KEY, "mph");
  const [shadeSource, setShadeSource] = useState<string>("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCachedSites().then((sites) => {
      setSite(sites.find((s) => s.code === siteCode) ?? null);
    });
  }, [siteCode]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    // §10 Privacy: GPS is read once, at the moment of the reading — never tracked.
    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition(pos),
      () => {},
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const sun = parseFloat(sunTemp);
  const shade = parseFloat(shadeTemp);
  const delta = useMemo(() => {
    if (Number.isNaN(sun) || Number.isNaN(shade)) return null;
    return sun - shade;
  }, [sun, shade]);

  const deltaWarning =
    delta == null ? null : delta < 0 ? "negative" : delta > 60 ? "implausible" : null;

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  // Wind is optional, always stored in mph, converted here from whatever the
  // anemometer shows. Only mph ever leaves this form.
  const windUnit: WindUnit = (WIND_UNITS as readonly string[]).includes(storedWindUnit)
    ? (storedWindUnit as WindUnit)
    : "mph";
  const meanInput = parseOptionalSpeed(windSpeed);
  const gustInput = parseOptionalSpeed(windGust);
  const windMph = meanInput.value === null ? null : roundMph(toMph(meanInput.value, windUnit));
  const windGustMph = gustInput.value === null ? null : roundMph(toMph(gustInput.value, windUnit));
  // The server rejects values beyond these; catching them here keeps a
  // mistyped reading from sitting in the upload queue with an error forever.
  const windTooHigh = (windMph ?? 0) > 120 || (windGustMph ?? 0) > 150;
  const windInvalid = meanInput.invalid || gustInput.invalid || windTooHigh;
  const gustBelowMean = windMph !== null && windGustMph !== null && windGustMph < windMph;
  const windVeryStrong = (windMph ?? 0) > WIND_SANITY_WARN_MPH;

  const canSave =
    observer.trim().length > 0 &&
    surfaceType !== "" &&
    shadeSource !== "" &&
    !Number.isNaN(sun) &&
    !Number.isNaN(shade) &&
    !windInvalid;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);

    try {
      setObserver(observer.trim());
      const id = crypto.randomUUID();

      // §7: save writes to IndexedDB immediately and returns to the list.
      // Never block the save on a network request.
      await queueReading({
        id,
        reading: {
          id,
          siteId: site?.id ?? null,
          observer: observer.trim(),
          recordedAt: recordedAt.toISOString(),
          lat: position?.coords.latitude ?? null,
          lng: position?.coords.longitude ?? null,
          gpsAccuracyM: position?.coords.accuracy ?? null,
          surfaceType: surfaceType as (typeof surfaceTypeValues)[number],
          sunTempF: sun,
          shadeTempF: shade,
          airTempF: airTemp === "" ? null : parseFloat(airTemp),
          shadeSource: shadeSource as (typeof shadeSourceValues)[number],
          windMph,
          windGustMph,
          windFrom: windFrom === "" ? null : (windFrom as (typeof windFromValues)[number]),
          photoUrl: null,
          notes: notes.trim() === "" ? null : notes.trim(),
        },
        photoBlob: photo,
        photoUrl: null,
        status: "pending",
        error: null,
        queuedAt: new Date().toISOString(),
      });

      // Fire-and-forget: sync in the background, don't await it.
      void syncPendingReadings();
      router.push("/field");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-xl px-4 py-4 pb-32">
      <div className="mb-4">
        <Link href="/field" className="inline-flex min-h-[44px] items-center text-base underline">
          ← All sites
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          {siteCode}
          {site ? ` · ${site.nameEn}` : ""}
        </h1>
        <p className="text-sm text-neutral-600 hc:text-yellow-200">
          {recordedAt.toLocaleString()} ·{" "}
          {position
            ? `GPS ±${Math.round(position.coords.accuracy)} m`
            : "GPS pending"}
        </p>
      </div>

      <Field label="Your first name">
        <input
          type="text"
          value={observer}
          onChange={(e) => setObserver(e.target.value)}
          autoComplete="given-name"
          required
          className="h-14 w-full rounded-lg border border-neutral-300 px-4 text-lg hc:border-yellow-400 hc:bg-black"
        />
      </Field>

      <ChoiceField
        label="Surface type"
        options={surfaceTypeValues}
        value={surfaceType}
        onChange={setSurfaceType}
        name="surface"
      />

      <Field label="SUN temperature (°F)">
        <input
          type="text"
          inputMode="decimal"
          value={sunTemp}
          onChange={(e) => setSunTemp(e.target.value)}
          required
          className="h-16 w-full rounded-lg border-2 border-amber-400 px-4 text-3xl font-bold hc:border-yellow-400 hc:bg-black"
        />
      </Field>

      <Field label="SHADE temperature (°F)">
        <input
          type="text"
          inputMode="decimal"
          value={shadeTemp}
          onChange={(e) => setShadeTemp(e.target.value)}
          required
          className="h-16 w-full rounded-lg border-2 border-blue-400 px-4 text-3xl font-bold hc:border-yellow-400 hc:bg-black"
        />
      </Field>

      <div
        aria-live="polite"
        className={`mb-4 rounded-xl px-4 py-4 text-center ${
          deltaWarning
            ? "bg-amber-100 text-amber-900 hc:bg-black hc:text-yellow-300 hc:border hc:border-yellow-400"
            : "bg-neutral-100 hc:bg-black hc:border hc:border-yellow-400"
        }`}
      >
        <p className="text-sm font-medium uppercase tracking-wide">Difference</p>
        <p className="text-5xl font-bold tabular-nums">
          {delta == null ? "—" : `${delta.toFixed(1)}°F`}
        </p>
        {deltaWarning === "negative" ? (
          <p className="mt-1 text-sm">
            Shade is hotter than sun. That&apos;s unusual — check your aim, then save anyway.
            It will be flagged for review, not thrown away.
          </p>
        ) : null}
        {deltaWarning === "implausible" ? (
          <p className="mt-1 text-sm">
            Over 60°F difference. Double-check both readings, then save. It will be flagged for
            review.
          </p>
        ) : null}
      </div>

      <Field label="Air temperature (°F, optional)">
        <input
          type="text"
          inputMode="decimal"
          value={airTemp}
          onChange={(e) => setAirTemp(e.target.value)}
          className="h-14 w-full rounded-lg border border-neutral-300 px-4 text-lg hc:border-yellow-400 hc:bg-black"
        />
      </Field>

      {/* Optional: the 60-second capture flow must not depend on it. Opens by
          itself when something has been entered so a filled-in value is
          never hidden. */}
      <details
        className="mb-4 rounded-lg border border-neutral-300 hc:border-yellow-400"
        open={windSpeed !== "" || windGust !== "" || windFrom !== "" ? true : undefined}
      >
        <summary className="flex min-h-[56px] cursor-pointer items-center px-4 text-base font-semibold">
          Wind (optional)
        </summary>
        <div className="px-4 pt-1">
          <p className="mb-3 text-sm text-neutral-600 hc:text-yellow-200">
            Hold the anemometer at chest height, facing into the wind. Use the average over
            about 30 seconds, and the highest gust in that time.
          </p>

          <Field label="Anemometer unit">
            <select
              value={windUnit}
              onChange={(e) => setWindUnit(e.target.value)}
              className="h-14 w-full rounded-lg border border-neutral-300 px-4 text-lg hc:border-yellow-400 hc:bg-black"
            >
              {WIND_UNITS.map((u) => (
                <option key={u} value={u}>
                  {WIND_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Wind speed, average (${WIND_UNIT_LABELS[windUnit]})`}>
            <input
              type="text"
              inputMode="decimal"
              value={windSpeed}
              onChange={(e) => setWindSpeed(e.target.value)}
              className="h-14 w-full rounded-lg border border-neutral-300 px-4 text-lg hc:border-yellow-400 hc:bg-black"
            />
          </Field>

          <Field label={`Highest gust (${WIND_UNIT_LABELS[windUnit]})`}>
            <input
              type="text"
              inputMode="decimal"
              value={windGust}
              onChange={(e) => setWindGust(e.target.value)}
              className="h-14 w-full rounded-lg border border-neutral-300 px-4 text-lg hc:border-yellow-400 hc:bg-black"
            />
          </Field>

          {windUnit !== "mph" && (windMph !== null || windGustMph !== null) ? (
            <p className="mb-3 text-sm font-medium" aria-live="polite">
              Saved as{" "}
              {[
                windMph !== null ? `${windMph} mph average` : null,
                windGustMph !== null ? `${windGustMph} mph gust` : null,
              ]
                .filter(Boolean)
                .join(", ")}
              .
            </p>
          ) : null}

          <ChoiceField
            label="Wind is coming FROM"
            options={windFromValues}
            value={windFrom}
            onChange={setWindFrom}
            name="wind-from"
          />
          {windFrom !== "" ? (
            <button
              type="button"
              onClick={() => setWindFrom("")}
              className="mb-3 min-h-[44px] rounded-lg border border-neutral-300 px-4 text-sm font-medium hc:border-yellow-400"
            >
              Clear direction
            </button>
          ) : null}

          <div aria-live="polite" className="mb-3 flex flex-col gap-2">
            {/* Blocking problems come first and alone: nothing else matters
                until they are fixed. Advisory notes can stack, so that fixing
                one never reveals another for the first time. */}
            {meanInput.invalid || gustInput.invalid ? (
              <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 hc:bg-black hc:text-yellow-300 hc:border hc:border-yellow-400">
                Wind speeds must be numbers, zero or more. Fix them or clear the box to save.
              </p>
            ) : windTooHigh ? (
              <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 hc:bg-black hc:text-yellow-300 hc:border hc:border-yellow-400">
                That is stronger than any wind we could record here (120 mph average, 150 mph
                gust). Check the unit above.
              </p>
            ) : (
              <>
                {windVeryStrong ? (
                  <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 hc:bg-black hc:text-yellow-300 hc:border hc:border-yellow-400">
                    Over {WIND_SANITY_WARN_MPH} mph is a very strong wind. Check the unit above is
                    the one your anemometer is showing.
                  </p>
                ) : null}
                {gustBelowMean ? (
                  <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 hc:bg-black hc:text-yellow-300 hc:border hc:border-yellow-400">
                    The gust is lower than the average, which cannot be. Check both numbers, then
                    save anyway. It will be flagged for review, not thrown away.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </details>

      <ChoiceField
        label="What is making the shade?"
        options={shadeSourceValues}
        value={shadeSource}
        onChange={setShadeSource}
        name="shade-source"
      />

      {/* Not a <Field>: this group contains its own <label for>, and nesting
          labels is invalid HTML — the outer one would capture the file
          input and shadow the button's name. */}
      <fieldset className="mb-4">
        <legend className="mb-2 block text-base font-semibold">Photo</legend>
        {/* §10 Privacy: no photo containing an identifiable person may be
            uploaded, and the crew gets a one-tap delete. */}
        <p className="mb-2 text-sm font-medium text-red-700 hc:text-yellow-300">
          Photograph the pavement and streetscape only. Do not upload a photo with a
          recognisable person in it.
        </p>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="sr-only"
          id="photo-input"
        />
        <div className="flex gap-2">
          <label
            htmlFor="photo-input"
            className="flex min-h-[56px] flex-1 items-center justify-center rounded-lg border-2 border-dashed border-neutral-400 px-4 text-lg font-medium hc:border-yellow-400"
          >
            {photo ? "Retake photo" : "Take photo"}
          </label>
          {photo ? (
            <button
              type="button"
              onClick={() => {
                setPhoto(null);
                if (photoInputRef.current) photoInputRef.current.value = "";
              }}
              className="min-h-[56px] rounded-lg bg-red-600 px-5 text-lg font-semibold text-white"
            >
              Delete
            </button>
          ) : null}
        </div>
        {photoPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoPreview}
            alt="Photo just taken, for review before saving"
            className="mt-2 max-h-48 w-full rounded-lg object-cover"
          />
        ) : null}
      </fieldset>

      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-lg hc:border-yellow-400 hc:bg-black"
        />
      </Field>

      {error ? (
        <p className="mb-4 rounded-md bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-4 hc:border-yellow-400 hc:bg-black">
        <button
          type="submit"
          disabled={!canSave || saving}
          className="h-16 w-full rounded-xl bg-neutral-900 text-xl font-bold text-white disabled:bg-neutral-300 disabled:text-neutral-500 hc:bg-yellow-400 hc:text-black hc:disabled:bg-neutral-700"
        >
          {saving ? "Saving…" : "Save reading"}
        </button>
        <p className="mt-2 text-center text-sm text-neutral-600 hc:text-yellow-200">
          Saves on this phone first. Uploads by itself when you have signal.
        </p>
      </div>
    </form>
  );
}

/** Wraps a single input. A <label> around one control is exactly right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block text-base font-semibold">{label}</span>
      {children}
    </label>
  );
}

/**
 * A group of choices needs fieldset/legend, NOT a wrapping <label>.
 * A label element wrapping several controls binds to the first one, which
 * made screen readers announce the first option of each group as the
 * group's own name ("Surface type" instead of "Asphalt") and broke voice
 * control for that option. fieldset/legend names the group without
 * shadowing any option.
 */
function ChoiceField({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  name: string;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 block text-base font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option;
          const id = `${name}-${option}`;
          return (
            <div key={option} className="relative flex flex-1">
              {/* Native radios: correct semantics, real keyboard behaviour
                  (arrow keys move within the group), and an accessible name
                  from the associated label that nothing can shadow.
                  Transparent and stretched over the whole control rather
                  than sr-only-sized, so the hit area for a pointer, a
                  screen reader, or voice control is the full 56px target
                  and not a 1px box some other element can sit on top of. */}
              <input
                type="radio"
                id={id}
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
              />
              <label
                htmlFor={id}
                className={`flex min-h-[56px] w-full items-center justify-center rounded-lg border-2 px-4 text-center text-lg font-medium capitalize peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 ${
                  selected
                    ? "border-neutral-900 bg-neutral-900 text-white hc:border-yellow-400 hc:bg-yellow-400 hc:text-black"
                    : "border-neutral-300 hc:border-yellow-400"
                }`}
              >
                {option.replace("_", " ")}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
