"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCachedSites, queueReading, type CachedSite } from "@/lib/offline-db";
import { syncPendingReadings } from "@/lib/sync";
import { shadeSourceValues, surfaceTypeValues } from "@/db/schema";

const OBSERVER_KEY = "shade:observer";

export default function CapturePage({ params }: { params: Promise<{ siteCode: string }> }) {
  const { siteCode } = use(params);
  const router = useRouter();

  const [site, setSite] = useState<CachedSite | null>(null);
  const [observer, setObserver] = useState("");
  const [recordedAt] = useState(() => new Date());
  const [surfaceType, setSurfaceType] = useState<string>("");
  const [sunTemp, setSunTemp] = useState("");
  const [shadeTemp, setShadeTemp] = useState("");
  const [airTemp, setAirTemp] = useState("");
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
    setObserver(window.localStorage.getItem(OBSERVER_KEY) ?? "");
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

  const canSave =
    observer.trim().length > 0 &&
    surfaceType !== "" &&
    shadeSource !== "" &&
    !Number.isNaN(sun) &&
    !Number.isNaN(shade);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);

    try {
      window.localStorage.setItem(OBSERVER_KEY, observer.trim());
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

      <Field label="Surface type">
        <ChoiceRow
          options={surfaceTypeValues}
          value={surfaceType}
          onChange={setSurfaceType}
          name="surface"
        />
      </Field>

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

      <Field label="What is making the shade?">
        <ChoiceRow
          options={shadeSourceValues}
          value={shadeSource}
          onChange={setShadeSource}
          name="shade-source"
        />
      </Field>

      <Field label="Photo">
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
      </Field>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block text-base font-semibold">{label}</span>
      {children}
    </label>
  );
}

function ChoiceRow({
  options,
  value,
  onChange,
  name,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            name={name}
            onClick={() => onChange(option)}
            className={`min-h-[56px] flex-1 rounded-lg border-2 px-4 text-lg font-medium capitalize ${
              selected
                ? "border-neutral-900 bg-neutral-900 text-white hc:border-yellow-400 hc:bg-yellow-400 hc:text-black"
                : "border-neutral-300 hc:border-yellow-400"
            }`}
          >
            {option.replace("_", " ")}
          </button>
        );
      })}
    </div>
  );
}
